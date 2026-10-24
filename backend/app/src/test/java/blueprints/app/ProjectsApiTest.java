package blueprints.app;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ProjectsApiTest {
    @Autowired
    TestRestTemplate rest;

    static ByteArrayResource part(String filename, byte[] data) {
        return new ByteArrayResource(data) {
            @Override
            public String getFilename() {
                return filename;
            }
        };
    }

    ResponseEntity<String> upload(Map<String, byte[]> files, boolean usePaths) {
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        for (var e : files.entrySet()) {
            body.add("files", part(usePaths ? e.getKey().replaceAll(".*/", "") : e.getKey(), e.getValue()));
            if (usePaths) body.add("paths", e.getKey());
        }
        var h = new org.springframework.http.HttpHeaders();
        h.setContentType(MediaType.MULTIPART_FORM_DATA);
        return rest.postForEntity("/api/projects", new HttpEntity<>(body, h), String.class);
    }

    static Map<String, byte[]> demoFiles() throws IOException {
        Path root = Path.of("../../samples/demo");
        Map<String, byte[]> m = new LinkedHashMap<>();
        try (Stream<Path> s = Files.walk(root)) {
            for (Path p : s.filter(Files::isRegularFile).sorted().toList()) {
                m.put("demo/" + root.relativize(p).toString().replace('\\', '/'), Files.readAllBytes(p));
            }
        }
        return m;
    }

    static byte[] zip(Map<String, byte[]> files) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(b)) {
            for (var e : files.entrySet()) {
                z.putNextEntry(new ZipEntry(e.getKey()));
                z.write(e.getValue());
                z.closeEntry();
            }
        }
        return b.toByteArray();
    }

    JsonNode json(String s) throws IOException {
        return Contract.JSON.readTree(s);
    }

    @Test
    void demoFolderUploadTreeAndExportRoundTrip() throws IOException {
        Map<String, byte[]> demo = demoFiles();
        var r = upload(demo, true);
        assertEquals(HttpStatus.CREATED, r.getStatusCode());
        JsonNode p = json(r.getBody());
        Contract.validate("Project", p);
        assertEquals(0, p.get("warnings").size());
        assertEquals(17, p.get("files").size());
        assertEquals("com.demo.Main", p.get("mainClasses").get(0).asText());
        assertEquals(6, p.get("tests").size());
        assertEquals("manual", p.get("tests").get(0).get("mode").asText()); // пара .in/.out — manual (решение человека)
        assertEquals(new String(demo.get("demo/tests/basic.out"), java.nio.charset.StandardCharsets.UTF_8),
                p.get("tests").get(0).get("expected").asText());
        String id = p.get("id").asText();

        JsonNode again = json(rest.getForObject("/api/projects/" + id, String.class));
        assertEquals(p, again);

        JsonNode tree = json(rest.getForObject("/api/projects/" + id + "/tree", String.class));
        Contract.validate("ProjectTree", tree);
        assertEquals("com.demo", tree.get("packages").get(0).get("name").asText());

        ResponseEntity<byte[]> ex = rest.getForEntity("/api/projects/" + id + "/export?format=zip", byte[].class);
        assertTrue(ex.getHeaders().getFirst("Content-Disposition").contains(".zip"));
        Map<String, byte[]> out = new LinkedHashMap<>();
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(ex.getBody()))) {
            for (ZipEntry e; (e = in.getNextEntry()) != null; ) out.put(e.getName(), in.readAllBytes());
        }
        // та же структура, что пришла, включая обёртку demo/; байты совпадают
        assertEquals(17 + 12, out.size());
        demo.forEach((k, v) -> {
            if (k.startsWith("demo/src/") || k.startsWith("demo/tests/")) assertArrayEquals(v, out.get(k), k);
        });
        ResponseEntity<byte[]> noSettings = rest.getForEntity("/api/projects/" + id + "/export?format=zip&includeSettings=false", byte[].class);
        assertTrue(noSettings.getBody().length < ex.getBody().length);

        // §11: jar демо через java -jar на IO-тестах даёт то же, что .out (локальная java, без Docker)
        ResponseEntity<byte[]> jar = rest.getForEntity("/api/projects/" + id + "/export?format=jar", byte[].class);
        assertEquals(HttpStatus.OK, jar.getStatusCode());
        assertEquals("attachment; filename=\"" + id + ".jar\"", jar.getHeaders().getFirst("Content-Disposition"));
        Path jarFile = Files.createTempFile("demo", ".jar");
        try {
            Files.write(jarFile, jar.getBody());
            int checked = 0;
            for (var e : demo.entrySet()) {
                if (!e.getKey().matches("demo/tests/.*\\.in")) continue;
                byte[] expected = demo.get(e.getKey().replaceAll("\\.in$", ".out"));
                assertEquals(text(expected), javaJar(jarFile, e.getValue()), e.getKey());
                checked++;
            }
            assertEquals(6, checked);
        } finally {
            Files.deleteIfExists(jarFile);
        }
    }

    /** stdout {@code java -jar}; CRLF -> LF: на Windows println пишет \r\n, а .out сняты в Linux. */
    static String javaJar(Path jar, byte[] stdin) throws IOException {
        Process p = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-Dstdout.encoding=UTF-8", "-jar", jar.toString()).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try (var in = p.getOutputStream()) {
            in.write(stdin);
        }
        return text(p.getInputStream().readAllBytes());
    }

    static String text(byte[] b) {
        return new String(b, StandardCharsets.UTF_8).replace("\r\n", "\n");
    }

    @Test
    void jarExportErrorsAre422() throws IOException {
        String main = "public static void main(String[] a) {}";
        String broken = json(upload(Map.of("A.java", ("class A { " + main + " void f() { nope(); } }").getBytes(StandardCharsets.UTF_8)), false)
                .getBody()).get("id").asText();
        var r = rest.getForEntity("/api/projects/" + broken + "/export?format=jar", String.class);
        assertError(r, HttpStatus.UNPROCESSABLE_ENTITY, "COMPILE_ERROR");
        assertTrue(json(r.getBody()).get("message").asText().contains("A.java:1: "), r.getBody());

        String two = json(upload(Map.of("A.java", ("class A { " + main + " }").getBytes(StandardCharsets.UTF_8),
                "B.java", ("class B { " + main + " }").getBytes(StandardCharsets.UTF_8)), false).getBody()).get("id").asText();
        assertError(rest.getForEntity("/api/projects/" + two + "/export?format=jar", String.class),
                HttpStatus.UNPROCESSABLE_ENTITY, "AMBIGUOUS_MAIN");
        assertError(rest.getForEntity("/api/projects/" + two + "/export?format=jar&mainClass=C", String.class),
                HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_REQUEST");
        assertEquals(HttpStatus.OK, rest.getForEntity("/api/projects/" + two + "/export?format=jar&mainClass=B", byte[].class).getStatusCode());

        String none = json(upload(Map.of("A.java", "class A {}".getBytes(StandardCharsets.UTF_8)), false).getBody()).get("id").asText();
        assertError(rest.getForEntity("/api/projects/" + none + "/export?format=jar", String.class),
                HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_REQUEST");
        assertEquals(HttpStatus.NOT_FOUND, rest.getForEntity("/api/projects/p-none/export?format=jar", String.class).getStatusCode());
    }

    @Test
    void zipUploadWithMismatchWarningMatchesFixtureShape() throws IOException {
        var r = upload(Map.of("p.zip", zip(Map.of(
                "README.md", new byte[0], // чтобы src/ не посчитался обёрткой
                "src/com/demo/util/Texts.java", "package com.demo.text; public class Texts {}".getBytes(StandardCharsets.UTF_8),
                "src/com/demo/Main.java", "package com.demo; public class Main { public static void main(String[] a) {} }".getBytes(StandardCharsets.UTF_8)))), false);
        assertEquals(HttpStatus.CREATED, r.getStatusCode());
        JsonNode p = json(r.getBody());
        Contract.validate("Project", p);
        assertEquals("PACKAGE_MISMATCH", p.get("warnings").get(0).get("code").asText());
        assertEquals("package com.demo.text не совпадает с папкой src/com/demo/util", p.get("warnings").get(0).get("message").asText());
    }

    @Test
    void rejectionsAreErrorsPerContract() throws IOException {
        var slip = upload(Map.of("e.zip", zip(Map.of("../x/A.java", new byte[] {'c'}))), false);
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, slip.getStatusCode());
        assertEquals("ZIP_SLIP", json(slip.getBody()).get("code").asText());
        Contract.validate("Error", json(slip.getBody()));

        var jar = upload(Map.of("lib.jar", zip(Map.of("a/A.class", new byte[] {1}))), false);
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, jar.getStatusCode());
        assertEquals("NO_SOURCES", json(jar.getBody()).get("code").asText());

        var dup = upload(new LinkedHashMap<>(Map.of(
                "a/A.java", "package a; class A {}".getBytes(StandardCharsets.UTF_8),
                "b/A.java", "package a; class A {}".getBytes(StandardCharsets.UTF_8))), true);
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, dup.getStatusCode());
        JsonNode dupErr = json(dup.getBody());
        Contract.validate("Error", dupErr);
        assertEquals("DUPLICATE_FQN", dupErr.get("code").asText());
        assertEquals(java.util.Set.of("a/A.java", "b/A.java"),
                java.util.Set.of(dupErr.get("files").get(0).asText(), dupErr.get("files").get(1).asText()));
        assertEquals(2, dupErr.get("files").size());

        var big = new byte[21 * 1024 * 1024];
        java.util.Arrays.fill(big, (byte) ' ');
        var bomb = upload(Map.of("bomb.zip", zip(Map.of("A.java", big))), false);
        assertEquals(HttpStatus.PAYLOAD_TOO_LARGE, bomb.getStatusCode());
        assertEquals("LIMIT_EXCEEDED", json(bomb.getBody()).get("code").asText());

        assertEquals(HttpStatus.NOT_FOUND, rest.getForEntity("/api/projects/nope", String.class).getStatusCode());
    }

    void assertError(ResponseEntity<String> r, HttpStatus status, String code) throws IOException {
        assertEquals(status, r.getStatusCode(), r.getBody());
        JsonNode err = json(r.getBody());
        Contract.validate("Error", err);
        assertEquals(code, err.get("code").asText());
    }

    @Test
    void nonUtf8ZipIs400Error() throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(bos, java.nio.charset.Charset.forName("CP866"))) {
            z.putNextEntry(new ZipEntry("Привет.java"));
            z.write("class A {}".getBytes(StandardCharsets.UTF_8));
            z.closeEntry();
        }
        assertError(upload(Map.of("ru.zip", bos.toByteArray()), false), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    }

    @Test
    void badParamsAndUnexpectedErrorsUseErrorBody() throws IOException {
        String id = json(upload(Map.of("A.java", "class A {}".getBytes(StandardCharsets.UTF_8)), false).getBody()).get("id").asText();
        assertError(rest.getForEntity("/api/projects/" + id + "/export?format=zip&includeSettings=abc", String.class),
                HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertError(rest.postForEntity("/api/_test/boom", null, String.class), HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL");
    }

    @Test
    void staleVersionGives409LikeFixture() throws IOException {
        JsonNode p = json(upload(Map.of("A.java", "class A {}".getBytes(StandardCharsets.UTF_8)), false).getBody());
        String id = p.get("id").asText();
        var ok = rest.postForEntity("/api/_test/" + id + "/touch?version=1", null, String.class);
        assertEquals(HttpStatus.OK, ok.getStatusCode());
        assertEquals(2, json(ok.getBody()).get("version").asInt());
        assertEquals(2, json(rest.getForObject("/api/projects/" + id, String.class)).get("version").asInt());

        var stale = rest.exchange("/api/_test/" + id + "/touch?version=1", HttpMethod.POST, null, String.class);
        assertEquals(HttpStatus.CONFLICT, stale.getStatusCode());
        JsonNode err = json(stale.getBody());
        Contract.validate("Error", err);
        JsonNode fx = Contract.fixture("error.conflict.json");
        assertEquals("VERSION_CONFLICT", err.get("code").asText());
        assertEquals(fx.get("message").asText().replaceAll("\\d+", "#"), err.get("message").asText().replaceAll("\\d+", "#"));
        assertEquals(fx.get("details").size(), err.get("details").size());
        assertEquals(1, err.get("details").get("clientVersion").asInt());
        assertEquals(2, err.get("details").get("serverVersion").asInt());
    }
}
