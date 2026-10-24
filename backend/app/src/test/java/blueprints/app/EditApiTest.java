package blueprints.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.blocks.AstToBlocks;
import blueprints.blocks.MethodLocator;
import blueprints.model.Block;
import com.fasterxml.jackson.databind.JsonNode;
import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class EditApiTest {
    static final String A = "class A {\n    int one() { return 1; }\n\n    int two(int x) {\n        // c\n        return x;\n    }\n"
            + "    A() {   }\n}\n";

    @Autowired
    TestRestTemplate rest;

    String upload(Map<String, byte[]> files) throws IOException {
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        files.forEach((path, data) -> {
            body.add("files", ProjectsApiTest.part(path.replaceAll(".*/", ""), data));
            body.add("paths", path);
        });
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.MULTIPART_FORM_DATA);
        var r = rest.postForEntity("/api/projects", new HttpEntity<>(body, h), String.class);
        assertEquals(HttpStatus.CREATED, r.getStatusCode(), r.getBody());
        return json(r.getBody()).get("id").asText();
    }

    String uploadA() throws IOException {
        return upload(Map.of("A.java", A.getBytes(StandardCharsets.UTF_8)));
    }

    static JsonNode json(String s) throws IOException {
        return Contract.JSON.readTree(s);
    }

    static Block tree(String text, String methodId) {
        var cu = new JavaParser(new ParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21))
                .parse(text).getResult().orElseThrow();
        return AstToBlocks.convert(MethodLocator.find(cu, methodId).orElseThrow(), methodId, "A.java");
    }

    static Block withBody(Block m, List<Block> body) {
        return new Block(m.id(), m.kind(), m.fields(), Map.of("body", body), m.span());
    }

    static Block leaf(String kind, String... kv) {
        Map<String, String> f = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) f.put(kv[i], kv[i + 1]);
        return new Block(null, kind, f, Map.of(), null);
    }

    ResponseEntity<String> put(String url, Object body) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        return rest.exchange(URI.create(rest.getRootUri() + url), HttpMethod.PUT,
                new HttpEntity<>(body instanceof String s ? s : Contract.JSON.valueToTree(body).toString(), h), String.class);
    }

    ResponseEntity<String> putBlocks(String id, String methodId, int version, Block root) {
        return put("/api/projects/" + id + "/methods/" + URLEncoder.encode(methodId, StandardCharsets.UTF_8) + "/blocks",
                Map.of("version", version, "root", root));
    }

    ResponseEntity<String> putFile(String id, String path, int version, String text) {
        return put("/api/projects/" + id + "/files?path=" + URLEncoder.encode(path, StandardCharsets.UTF_8),
                Map.of("version", version, "text", text));
    }

    int version(String id) throws IOException {
        return json(rest.getForObject("/api/projects/" + id, String.class)).get("version").asInt();
    }

    void assertError(ResponseEntity<String> r, HttpStatus status, String code) throws IOException {
        assertEquals(status, r.getStatusCode(), r.getBody());
        JsonNode err = json(r.getBody());
        Contract.validate("Error", err);
        assertEquals(code, err.get("code").asText());
    }

    @Test
    void putBlocksRoundTripKeepsOtherMethodsByteExact() throws IOException {
        String id = uploadA();
        Block two = tree(A, "A.two~0");
        var same = putBlocks(id, "A.two~0", 1, two);
        assertEquals(HttpStatus.OK, same.getStatusCode(), same.getBody());
        JsonNode m = json(same.getBody());
        Contract.validate("MutationResult", m);
        assertEquals(2, m.get("version").asInt());
        assertEquals(A, m.get("fileText").asText()); // неизменённое дерево — файл байт в байт
        assertEquals("A.two~0", m.get("method").get("methodId").asText());
        assertEquals("int two(int x)", m.get("method").get("signature").asText());

        List<Block> body = new ArrayList<>(two.slots().get("body"));
        body.add(1, leaf("assign", "target", "x", "op", "+=", "value", "one()"));
        var edited = putBlocks(id, "A.two~0", 2, withBody(two, body));
        assertEquals(HttpStatus.OK, edited.getStatusCode(), edited.getBody());
        JsonNode e = json(edited.getBody());
        Contract.validate("MutationResult", e);
        assertEquals(3, e.get("version").asInt());
        assertEquals("class A {\n    int one() { return 1; }\n\n    int two(int x) {\n        // c\n        x += one();\n"
                + "        return x;\n    }\n    A() {   }\n}\n", e.get("fileText").asText());
        JsonNode newBody = e.get("method").get("root").get("slots").get("body");
        assertEquals(List.of("comment", "assign", "return"), List.of(newBody.get(0).get("kind").asText(),
                newBody.get(1).get("kind").asText(), newBody.get(2).get("kind").asText()));
        assertEquals("A.two~0/body/1", newBody.get(1).get("id").asText());
        assertEquals(3, version(id));

        // конструктор: id с <init> в пути
        Block ctor = tree(A, "A.<init>~0");
        var c = putBlocks(id, "A.<init>~0", 3, withBody(ctor, List.of(leaf("expr", "text", "System.out.println()"))));
        assertEquals(HttpStatus.OK, c.getStatusCode(), c.getBody());
        assertTrue(json(c.getBody()).get("fileText").asText().endsWith("    A() {\n        System.out.println();\n    }\n}\n"));
    }

    @Test
    void invalidNodeIs422WithBlockIdAndChangesNothing() throws IOException {
        String id = uploadA();
        Block two = tree(A, "A.two~0");
        List<Block> body = new ArrayList<>(two.slots().get("body"));
        body.add(leaf("expr", "text", "foo("));
        var r = putBlocks(id, "A.two~0", 1, withBody(two, body));
        assertError(r, HttpStatus.UNPROCESSABLE_ENTITY, "PARSE_ERROR");
        assertEquals("A.two~0/body/2", json(r.getBody()).get("blockId").asText());
        assertEquals(1, version(id));

        body.set(2, leaf("comment", "text", "x \\u000a y"));
        var unsafe = putBlocks(id, "A.two~0", 1, withBody(two, body));
        assertError(unsafe, HttpStatus.UNPROCESSABLE_ENTITY, "PARSE_ERROR");
        assertEquals("A.two~0/body/2", json(unsafe.getBody()).get("blockId").asText());

        body.set(2, leaf("expr", "text", "System.out.print(\"\\u0041\")"));
        assertError(putBlocks(id, "A.two~0", 1, withBody(two, body)), HttpStatus.UNPROCESSABLE_ENTITY, "PARSE_ERROR");
        assertEquals(1, version(id));

        assertError(putBlocks(id, "A.nope~0", 1, two), HttpStatus.NOT_FOUND, "NOT_FOUND");
        assertError(putBlocks("p-none", "A.two~0", 1, two), HttpStatus.NOT_FOUND, "NOT_FOUND");
    }

    @Test
    void staleVersionIs409() throws IOException {
        String id = uploadA();
        Block two = tree(A, "A.two~0");
        assertEquals(HttpStatus.OK, putBlocks(id, "A.two~0", 1, two).getStatusCode());
        var stale = putBlocks(id, "A.two~0", 1, two);
        assertError(stale, HttpStatus.CONFLICT, "VERSION_CONFLICT");
        assertEquals(2, json(stale.getBody()).get("details").get("serverVersion").asInt());
        assertError(putFile(id, "A.java", 1, A), HttpStatus.CONFLICT, "VERSION_CONFLICT");
        assertEquals(2, version(id));
    }

    @Test
    void putFileUpdatesTreeAndRejectsSyntaxErrors() throws IOException {
        String id = uploadA();
        String text = A.replace("    A() {   }\n", "    A() {   }\n    int three() { return 3; }\n");
        var r = putFile(id, "A.java", 1, text);
        assertEquals(HttpStatus.OK, r.getStatusCode(), r.getBody());
        JsonNode m = json(r.getBody());
        Contract.validate("MutationResult", m);
        assertFalse(m.has("method"));
        assertEquals(text, m.get("fileText").asText());
        JsonNode methods = m.get("tree").get("packages").get(0).get("files").get(0).get("classes").get(0).get("methods");
        assertEquals("A.three~0", methods.get(2).get("id").asText());
        assertEquals("O(1)", methods.get(2).get("complexity").asText());
        assertEquals(json(rest.getForObject("/api/projects/" + id + "/tree", String.class)).get("packages").get(0).get("files")
                .get(0).get("classes").get(0).get("methods").size(), 3);

        var bad = putFile(id, "A.java", 2, "class A {\n    void f() {\n        int x = ;\n    }\n}\n");
        assertError(bad, HttpStatus.UNPROCESSABLE_ENTITY, "PARSE_ERROR");
        assertEquals(3, json(bad.getBody()).get("line").asInt());
        assertEquals(2, version(id));
        assertError(putFile(id, "B.java", 2, text), HttpStatus.NOT_FOUND, "NOT_FOUND");

        // экспорт отдаёт новый текст
        byte[] zip = rest.getForObject("/api/projects/" + id + "/export?format=zip", byte[].class);
        try (var in = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(zip))) {
            assertEquals("A.java", in.getNextEntry().getName());
            assertEquals(text, new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    /** PUT files пересчитывает состояние загрузки: пакет, PACKAGE_MISMATCH, mainClasses; дубликат FQN — 422, как при загрузке. */
    @Test
    void putFileRecomputesLoadState() throws IOException {
        Map<String, byte[]> files = new LinkedHashMap<>();
        files.put("README.md", new byte[0]); // держит root "": src/ не обёртка и после правки
        files.put("src/a/A.java", "package a; class A {}".getBytes(StandardCharsets.UTF_8));
        files.put("src/a/B.java", "package a; class B {}".getBytes(StandardCharsets.UTF_8));
        String id = upload(files);
        JsonNode p = json(rest.getForObject("/api/projects/" + id, String.class));
        assertEquals(0, p.get("mainClasses").size());
        assertEquals(0, p.get("warnings").size());

        var r = putFile(id, "src/a/A.java", 1, "package b; class A { public static void main(String[] x) {} }");
        assertEquals(HttpStatus.OK, r.getStatusCode(), r.getBody());
        p = json(rest.getForObject("/api/projects/" + id, String.class));
        Contract.validate("Project", p);
        assertEquals("[\"b.A\"]", p.get("mainClasses").toString());
        assertEquals("PACKAGE_MISMATCH", p.get("warnings").get(0).get("code").asText());
        assertEquals("src/a/A.java", p.get("warnings").get(0).get("file").asText());
        assertEquals("b", p.get("files").get(0).get("package").asText());
        assertEquals("src/a/A.java", p.get("files").get(0).get("path").asText()); // обёртка не отрезана заново

        var dup = putFile(id, "src/a/B.java", 2, "package b; class A {}");
        assertError(dup, HttpStatus.UNPROCESSABLE_ENTITY, "DUPLICATE_FQN");
        assertEquals("[\"src/a/A.java\",\"src/a/B.java\"]", json(dup.getBody()).get("files").toString());
        assertEquals(2, version(id));

        // main убран, пакет возвращён — состояние снова как у загрузки
        assertEquals(HttpStatus.OK, putFile(id, "src/a/A.java", 2, "package a; class A {}").getStatusCode());
        p = json(rest.getForObject("/api/projects/" + id, String.class));
        assertEquals(0, p.get("mainClasses").size());
        assertEquals(0, p.get("warnings").size());
        assertEquals("a", p.get("files").get(0).get("package").asText());
        assertEquals(HttpStatus.OK, rest.getForEntity("/api/projects/" + id + "/files?path=src/a/B.java", String.class).getStatusCode());
    }

    /** Обёртка demo/ сохраняется при пересчёте: пути без неё, PACKAGE_MISMATCH сверяется с полным путём, экспорт с ней. */
    @Test
    void putFileRecomputesLoadStateUnderWrapper() throws IOException {
        Map<String, byte[]> files = new LinkedHashMap<>();
        files.put("demo/com/a/A.java", "package com.a; class A {}".getBytes(StandardCharsets.UTF_8));
        files.put("demo/com/a/B.java", "package com.a; class B {}".getBytes(StandardCharsets.UTF_8));
        String id = upload(Map.of("p.zip", ProjectsApiTest.zip(files)));
        String text = "package demo.com.a; class A { public static void main(String[] x) {} }";
        var r = putFile(id, "com/a/A.java", 1, text);
        assertEquals(HttpStatus.OK, r.getStatusCode(), r.getBody());
        JsonNode p = json(rest.getForObject("/api/projects/" + id, String.class));
        Contract.validate("Project", p);
        assertEquals("[\"demo.com.a.A\"]", p.get("mainClasses").toString());
        assertEquals(0, p.get("warnings").size()); // demo/com/a — папка пакета demo.com.a
        assertEquals("com/a/A.java", p.get("files").get(0).get("path").asText());

        assertEquals(HttpStatus.OK, putFile(id, "com/a/B.java", 2, "package x; class B {}").getStatusCode());
        p = json(rest.getForObject("/api/projects/" + id, String.class));
        assertEquals("PACKAGE_MISMATCH", p.get("warnings").get(0).get("code").asText());
        assertEquals("com/a/B.java", p.get("warnings").get(0).get("file").asText());

        byte[] zip = rest.getForObject("/api/projects/" + id + "/export?format=zip", byte[].class);
        try (var in = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(zip))) {
            assertEquals("demo/com/a/A.java", in.getNextEntry().getName());
            assertEquals(text, new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    /** Проект ровно на лимите файлов (root "", src/ и tests/): пересчёт не добавляет лишних файлов и PUT проходит. */
    @Test
    void putFileAtFileLimit() throws IOException {
        Map<String, byte[]> files = new LinkedHashMap<>();
        for (int i = 0; i < blueprints.source.ProjectLoader.MAX_FILES - 1; i++) {
            files.put("src/A" + i + ".java", ("class A" + i + " {}").getBytes(StandardCharsets.UTF_8));
        }
        files.put("tests/t.json", "{}".getBytes(StandardCharsets.UTF_8));
        String id = upload(Map.of("p.zip", ProjectsApiTest.zip(files)));
        var r = putFile(id, "src/A0.java", 1, "class A0 { int x; }");
        assertEquals(HttpStatus.OK, r.getStatusCode(), r.getBody());
    }

    /** Правка, выводящая проект за 20 МБ: 422 LIMIT_EXCEEDED (не 413, как у загрузки), версия и текст прежние. */
    @Test
    void putFileOverSizeLimitIs422() throws IOException {
        // одна строка JSON у Jackson до 20 млн символов — лимит набирается двумя файлами: 15 МБ в загрузке + 6 МБ правкой
        int mb = 1024 * 1024;
        String id = upload(Map.of("A.java", A.getBytes(StandardCharsets.UTF_8),
                "B.java", ("class B {\n/* " + "x".repeat(15 * mb) + " */\n}\n").getBytes(StandardCharsets.UTF_8)));
        String huge = "class A {\n    /* " + "x".repeat(6 * mb) + " */\n}\n";
        assertError(putFile(id, "A.java", 1, huge), HttpStatus.UNPROCESSABLE_ENTITY, "LIMIT_EXCEEDED");
        assertEquals(1, version(id));
        assertEquals(A, json(rest.getForObject("/api/projects/" + id + "/files?path=A.java", String.class)).get("text").asText());
    }

    /** На демо: проблемы анализа с blockId из дерева метода, метрики и issueCount — по контракту. */
    @Test
    void demoMutationCarriesAnalysis() throws IOException {
        String id = upload(ProjectsApiTest.demoFiles());
        String path = "src/com/demo/service/OrderService.java";
        String text = new String(ProjectsApiTest.demoFiles().get("demo/" + path), StandardCharsets.UTF_8);
        var r = putBlocks(id, "com.demo.service.OrderService.merge~0", 1, tree(text, "com.demo.service.OrderService.merge~0"));
        assertEquals(HttpStatus.OK, r.getStatusCode(), r.getBody());
        JsonNode m = json(r.getBody());
        Contract.validate("MutationResult", m);
        assertEquals(text, m.get("fileText").asText());
        JsonNode nested = null;
        for (JsonNode i : m.get("analysis").get("issues")) {
            if (i.get("rule").asText().equals("NestedLoopSameCollection")) nested = i;
        }
        assertEquals("com.demo.service.OrderService.merge~0/body/1/body/2", nested.get("blockId").asText());
        JsonNode loop = m.get("method").get("root").get("slots").get("body").get(1).get("slots").get("body").get(2);
        assertEquals(nested.get("id").asText(), loop.get("issues").get(0).asText());
        assertEquals(10000, m.get("analysis").get("n").asInt());
        assertTrue(m.get("analysis").get("metrics").size() > 50);
    }

    @Test
    void brokenJsonAndMultipartAre400() throws IOException {
        String id = uploadA();
        assertError(put("/api/projects/" + id + "/methods/A.two~0/blocks", "{\"version\": 1, \"root\": "),
                HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertError(put("/api/projects/" + id + "/files?path=A.java", "{\"version\": \"x\"}"), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertError(put("/api/projects/" + id + "/files?path=A.java", "{\"version\": 1}"), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");

        HttpHeaders h = new HttpHeaders();
        h.set(HttpHeaders.CONTENT_TYPE, "multipart/form-data; boundary=xyz");
        var broken = rest.postForEntity("/api/projects", new HttpEntity<>("--xyz\r\nContent-Disposition: form-data; name=\"files\"; "
                + "filename=\"A.java\"\r\n\r\nclass A {}", h), String.class);
        assertError(broken, HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertTrue(json(broken.getBody()).get("message").asText().contains("multipart"), broken.getBody());
    }
}
