package blueprints.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import blueprints.app.ProjectDto.FileDto;
import blueprints.app.ProjectDto.TestCaseDto;
import blueprints.source.LoadWarning;
import blueprints.source.ProjectLoader;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
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
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

/** Фикстуры валидны схеме, а наши DTO сериализуются в ту же форму, что фикстура project.json. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ContractConformanceTest {
    @Autowired
    TestRestTemplate rest;

    /** GET blocks / files / analysis на демо — по схемам, совпадают с ProjectView; неизвестное — 404 Error. */
    @Test
    void getEndpointsOnDemoMatchSchemas() throws IOException {
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        var demo = ProjectsApiTest.demoFiles();
        demo.forEach((path, data) -> {
            body.add("files", ProjectsApiTest.part(path.replaceAll(".*/", ""), data));
            body.add("paths", path);
        });
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.MULTIPART_FORM_DATA);
        var created = rest.postForEntity("/api/projects", new HttpEntity<>(body, h), String.class);
        assertEquals(HttpStatus.CREATED, created.getStatusCode(), created.getBody());
        String id = Contract.JSON.readTree(created.getBody()).get("id").asText();
        String base = "/api/projects/" + id;
        String merge = "com.demo.service.OrderService.merge~0";

        JsonNode method = ok(rest.getForEntity(base + "/methods/" + merge + "/blocks", String.class));
        Contract.validate("MethodView", method);
        assertEquals(merge, method.get("methodId").asText());
        assertEquals(Contract.fixture("method-view.merge.json").get("signature"), method.get("signature"));

        String upPath = demo.keySet().stream().filter(p -> p.endsWith("OrderService.java")).findFirst().orElseThrow();
        String path = "src/com/demo/service/OrderService.java"; // обёртка demo/ отрезана при загрузке
        JsonNode file = ok(rest.getForEntity(base + "/files?path={p}", String.class, path));
        Contract.validate("FileText", file);
        assertEquals(path, file.get("path").asText());
        assertEquals(new String(demo.get(upPath), java.nio.charset.StandardCharsets.UTF_8), file.get("text").asText());
        assertEquals(1, file.get("version").asInt());

        JsonNode analysis = ok(rest.getForEntity(base + "/analysis?n=500", String.class));
        Contract.validate("Analysis", analysis);
        assertEquals(1, analysis.get("version").asInt());
        assertEquals(10000, analysis.get("n").asInt());
        JsonNode rule = Contract.fixture("analysis.merge.json").get("issues").get(0).get("rule");
        assertTrue(analysis.get("issues").findValues("rule").contains(rule), "нет проблемы " + rule);

        notFound(rest.getForEntity(base + "/methods/com.demo.Nope.x~0/blocks", String.class));
        notFound(rest.getForEntity(base + "/files?path=nope.java", String.class));
        notFound(rest.getForEntity("/api/projects/p-none/analysis", String.class));
        notFound(rest.getForEntity("/api/projects/p-none/files?path={p}", String.class, path));
        notFound(rest.getForEntity("/api/projects/p-none/methods/" + merge + "/blocks", String.class));
    }

    static JsonNode ok(ResponseEntity<String> r) throws IOException {
        assertEquals(HttpStatus.OK, r.getStatusCode(), r.getBody());
        return Contract.JSON.readTree(r.getBody());
    }

    static void notFound(ResponseEntity<String> r) throws IOException {
        assertEquals(HttpStatus.NOT_FOUND, r.getStatusCode(), r.getBody());
        JsonNode err = Contract.JSON.readTree(r.getBody());
        Contract.validate("Error", err);
        assertEquals("NOT_FOUND", err.get("code").asText());
    }

    @Test
    void fixturesMatchSchemas() throws IOException {
        Contract.validate("Project", Contract.fixture("project.json"));
        Contract.validate("ProjectTree", Contract.fixture("tree.json"));
        Contract.validate("Error", Contract.fixture("error.conflict.json"));
        Contract.validate("Analysis", Contract.fixture("analysis.merge.json"));
        Contract.validate("MethodView", Contract.fixture("method-view.merge.json"));
    }

    /** Analysis / MethodView / ProjectTree из ProjectView на демо — по схемам; проблема merge — как в фикстуре. */
    @Test
    void projectViewOnDemoMatchesSchemasAndFixture() throws IOException {
        List<ProjectLoader.Upload> ups = new ArrayList<>();
        ProjectsApiTest.demoFiles().forEach((k, v) -> ups.add(new ProjectLoader.Upload(k, v)));
        ProjectView view = new ProjectView(ProjectLoader.load(ups));
        var mapper = Contract.JSON.copy().setSerializationInclusion(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL);
        JsonNode analysis = mapper.valueToTree(view.analysis(3));
        Contract.validate("Analysis", analysis);
        Contract.validate("ProjectTree", mapper.valueToTree(view.tree(3)));
        String merge = "com.demo.service.OrderService.merge~0";
        Contract.validate("MethodView", mapper.valueToTree(view.method(merge)));

        JsonNode fx = Contract.fixture("analysis.merge.json");
        JsonNode expected = fx.get("issues").get(0);
        JsonNode actual = null;
        for (JsonNode i : analysis.get("issues")) if (i.get("rule").asText().equals(expected.get("rule").asText())) actual = i;
        for (String f : List.of("span", "methodId", "blockId", "severity", "confidence", "source")) {
            assertEquals(expected.get(f), actual.get(f), f);
        }
        JsonNode metric = null;
        for (JsonNode x : analysis.get("metrics")) if (x.get("methodId").asText().equals(merge)) metric = x;
        assertEquals(fx.get("metrics").get(0).get("lines"), metric.get("lines"));
        assertEquals(fx.get("n"), analysis.get("n"));
    }

    @Test
    void projectDtoSerializesLikeFixture() throws IOException {
        var dto = new ProjectDto("p-1", 1,
                List.of(new FileDto("src/com/demo/Main.java", "com.demo"),
                        new FileDto("src/com/demo/service/OrderService.java", "com.demo.service"),
                        new FileDto("src/com/demo/util/Texts.java", "com.demo.text")),
                List.of(new LoadWarning("PACKAGE_MISMATCH", "src/com/demo/util/Texts.java",
                        "package com.demo.text не совпадает с папкой src/com/demo/util")),
                List.of(new TestCaseDto("merge", "io", "CUSTOMER 1 Alice gold\n", "original", null, List.of(), null)),
                List.of("com.demo.Main"));
        // тот же ObjectMapper-настройки, что в приложении: non_null
        var mapper = Contract.JSON.copy().setSerializationInclusion(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL);
        JsonNode actual = mapper.valueToTree(dto);
        assertEquals(Contract.fixture("project.json"), actual);
        Contract.validate("Project", actual);
    }

    /** Ошибки tests/run/verify (409 PUT/DELETE tests, 422 AMBIGUOUS_MAIN/INVALID_REQUEST, 503 песочница) — тело Error. */
    @Test
    void runVerifyTestErrorsMatchErrorSchema() {
        var mapper = Contract.JSON.copy().setSerializationInclusion(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL);
        var handler = new ApiErrorHandler();
        for (ApiException e : List.of(
                new ApiException(409, "VERSION_CONFLICT", "Версия проекта устарела: клиент 2, сервер 3",
                        java.util.Map.of("clientVersion", 2, "serverVersion", 3)),
                new ApiException(422, "AMBIGUOUS_MAIN", "несколько main-классов", java.util.Map.of("mainClasses", List.of("A", "B"))),
                new ApiException(422, "INVALID_REQUEST", "IO-тестам нужен метод main"),
                new ApiException(503, "INTERNAL", "Контейнер не запустился за 120 с"))) {
            var r = handler.api(e);
            assertEquals(e.status(), r.getStatusCode().value());
            Contract.validate("Error", mapper.valueToTree(r.getBody()));
        }
    }

    /** Фикстуры тестов/запуска валидны схемам, а DTO run/verify/tests сериализуются в их форму. */
    @Test
    void runVerifyTestDtosSerializeLikeFixtures() throws IOException {
        Contract.validate("RunResult", Contract.fixture("run.ok.json"));
        Contract.validate("TestCase", Contract.fixture("test.junit.json"));
        Contract.validate("VerifyResult", Contract.fixture("verify.green.json"));
        Contract.validate("VerifyResult", Contract.fixture("verify.red.json"));
        var mapper = Contract.JSON.copy().setSerializationInclusion(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL);

        var run = new RunController.RunDto("merged=2\n", "", 0, false, 820, List.of());
        assertEquals(Contract.fixture("run.ok.json"), mapper.valueToTree(run));
        Contract.validate("RunResult", mapper.valueToTree(new RunController.RunDto("", "", -1, false, 0,
                List.of(RunController.compileError("Main.java:3: cannot find symbol", java.util.Map.of("src/Main.java", ""))))));

        var red = new blueprints.testing.VerifyResult(blueprints.testing.VerifyResult.Status.RED, List.of(
                new blueprints.testing.TestResult("merge", "io", blueprints.testing.TestStatus.FAILED, 655, null,
                        "merged=2\n", "merged=1\n", List.of())), List.of());
        var dto = new RunController.VerifyDto(red.status().wire(), red.results().stream().map(RunController::dto).toList(),
                red.warnings());
        JsonNode actual = mapper.valueToTree(dto);
        Contract.validate("VerifyResult", actual);
        JsonNode fx = Contract.fixture("verify.red.json");
        assertEquals(fx.get("status"), actual.get("status"));
        assertEquals(fx.get("results").get(1), actual.get("results").get(0));

        JsonNode junit = Contract.fixture("test.junit.json");
        var tc = new TestCaseDto("OrderServiceTest", "junit", null, null, null, null, junit.get("source").asText());
        JsonNode tcJson = mapper.valueToTree(tc);
        Contract.validate("TestCase", tcJson);
        Contract.validate("TestMutationResult", mapper.valueToTree(new TestsController.TestMutation(3, tc)));
        assertEquals(junit.get("source"), tcJson.get("source"));
    }

    /** GET export?format=jar: 200 application/octet-stream + Content-Disposition attachment *.jar; 422 — тело Error. */
    @Test
    void jarExportMatchesContract() throws IOException {
        String id = uploadDemo(ProjectsApiTest.demoFiles());
        ResponseEntity<byte[]> r = rest.getForEntity("/api/projects/" + id + "/export?format=jar&mainClass=com.demo.Main", byte[].class);
        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertEquals(MediaType.APPLICATION_OCTET_STREAM, r.getHeaders().getContentType());
        assertTrue(r.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION).matches("attachment; filename=\".+\\.jar\""));
        var err = rest.getForEntity("/api/projects/" + id + "/export?format=jar&mainClass=com.demo.Nope", String.class);
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, err.getStatusCode());
        Contract.validate("Error", Contract.JSON.readTree(err.getBody()));
        var mapper = Contract.JSON.copy().setSerializationInclusion(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL);
        Contract.validate("Error", mapper.valueToTree(new ApiErrorHandler().api(
                new ApiException(422, "COMPILE_ERROR", "проект не компилируется: src/A.java:1: cannot find symbol")).getBody()));
    }

    static final String JOIN = "com.demo.util.Texts.join~0";
    static final String REPORT = "com.demo.service.ReportService.fullReport~0";

    String uploadDemo(Map<String, byte[]> files) throws IOException {
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        files.forEach((path, data) -> {
            body.add("files", ProjectsApiTest.part(path.replaceAll(".*/", ""), data));
            body.add("paths", path);
        });
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.MULTIPART_FORM_DATA);
        var created = rest.postForEntity("/api/projects", new HttpEntity<>(body, h), String.class);
        assertEquals(HttpStatus.CREATED, created.getStatusCode(), created.getBody());
        return Contract.JSON.readTree(created.getBody()).get("id").asText();
    }

    /** id проблемы StringConcatInLoop в методе. */
    JsonNode concatIssue(String id, String methodId) throws IOException {
        for (JsonNode i : ok(rest.getForEntity("/api/projects/" + id + "/analysis", String.class)).get("issues")) {
            if (i.get("rule").asText().equals("StringConcatInLoop") && i.get("methodId").asText().equals(methodId)) return i;
        }
        throw new AssertionError("нет StringConcatInLoop в " + methodId);
    }

    ResponseEntity<String> fix(String id, String issueId, int version, String fixId) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        String body = Contract.JSON.createObjectNode().put("version", version).put("fixId", fixId).toString();
        return rest.exchange(java.net.URI.create(rest.getRootUri() + "/api/projects/" + id + "/issues/"
                + java.net.URLEncoder.encode(issueId, java.nio.charset.StandardCharsets.UTF_8).replace("+", "%20") + "/fix"),
                org.springframework.http.HttpMethod.POST, new HttpEntity<>(body, h), String.class);
    }

    @Test
    void fixFixturesAndDtoMatchFixResult() throws IOException {
        Contract.validate("FixResult", Contract.fixture("fix.applied.json"));
        Contract.validate("FixResult", Contract.fixture("fix.rejected.json"));
        var mapper = Contract.JSON.copy().setSerializationInclusion(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL);
        JsonNode fx = Contract.fixture("fix.rejected.json");
        var verify = Contract.JSON.treeToValue(fx.get("verify"), RunController.VerifyDto.class);
        var dto = new FixController.FixDto(false, fx.get("reason").asText(), 3, null, null, verify);
        assertEquals(fx, mapper.valueToTree(dto));
        Contract.validate("FixResult", mapper.valueToTree(new FixController.FixDto(false, "исправление не подтверждено: x", 1,
                null, null, null)));
    }

    @Test
    void unifiedDiff() {
        String a = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n";
        String b = "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n";
        assertEquals("--- a/x.java\n+++ b/x.java\n@@ -1,5 +1,5 @@\n a\n-b\n+B\n c\n d\n e\n"
                + "@@ -9,3 +9,4 @@\n i\n j\n k\n+l\n", Diff.unified("x.java", a, b));
        assertEquals("", Diff.unified("x.java", a, a));
    }

    /** Issue.fixes на демо; 409 при чужой версии, 404 на неизвестную проблему / фикс — без Docker. */
    @Test
    void fixesInAnalysisAndFixErrors() throws IOException {
        String id = uploadDemo(ProjectsApiTest.demoFiles());
        JsonNode analysis = ok(rest.getForEntity("/api/projects/" + id + "/analysis", String.class));
        Contract.validate("Analysis", analysis);
        for (JsonNode i : analysis.get("issues")) {
            if (i.get("confidence").asText().equals("low")) assertEquals(0, i.get("fixes").size(), i.toString());
        }
        JsonNode join = concatIssue(id, JOIN);
        assertEquals("[\"string-builder\"]", join.get("fixes").toString());
        String issueId = join.get("id").asText();

        var conflict = fix(id, issueId, 7, "string-builder");
        assertEquals(HttpStatus.CONFLICT, conflict.getStatusCode(), conflict.getBody());
        Contract.validate("Error", Contract.JSON.readTree(conflict.getBody()));
        notFound(fix(id, "StringConcatInLoop:nope:1:1", 1, "string-builder"));
        notFound(fix(id, issueId, 1, "nope"));
        notFound(fix("p-none", issueId, 1, "string-builder"));
    }

    /** Quality Gate в Docker: string-builder на Texts.join — applied; с неверным tests/basic.out — rejected. */
    @Test
    void fixAppliedAndRejectedInDocker() throws IOException {
        assumeTrue(TestsApiTest.dockerUp(), "docker недоступен");
        String id = uploadDemo(ProjectsApiTest.demoFiles());
        JsonNode applied = ok(fix(id, concatIssue(id, JOIN).get("id").asText(), 1, "string-builder"));
        Contract.validate("FixResult", applied);
        assertTrue(applied.get("applied").asBoolean(), applied.toString());
        assertEquals(2, applied.get("version").asInt());
        assertEquals("green", applied.get("verify").get("status").asText(), applied.toString());
        String diff = applied.get("diff").asText();
        assertTrue(diff.startsWith("--- a/src/com/demo/util/Texts.java\n+++ b/src/com/demo/util/Texts.java\n@@ "), diff);
        assertTrue(diff.contains("\n+        StringBuilder "), diff);
        JsonNode file = ok(rest.getForEntity("/api/projects/" + id + "/files?path={p}", String.class, "src/com/demo/util/Texts.java"));
        assertEquals(2, file.get("version").asInt());
        assertTrue(file.get("text").asText().contains("StringBuilder outSb"), file.get("text").asText());
        assertEquals(file.get("text"), applied.get("mutation").get("fileText"));
        for (JsonNode i : ok(rest.getForEntity("/api/projects/" + id + "/analysis", String.class)).get("issues")) {
            assertFalse(i.get("rule").asText().equals("StringConcatInLoop") && i.get("methodId").asText().equals(JOIN), i.toString());
        }

        Map<String, byte[]> broken = new LinkedHashMap<>(ProjectsApiTest.demoFiles());
        broken.put("demo/tests/basic.out", "not the output\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        String bad = uploadDemo(broken);
        JsonNode rejected = ok(fix(bad, concatIssue(bad, REPORT).get("id").asText(), 1, "string-builder"));
        Contract.validate("FixResult", rejected);
        assertFalse(rejected.get("applied").asBoolean(), rejected.toString());
        assertEquals(1, rejected.get("version").asInt());
        assertTrue(rejected.get("reason").asText().startsWith("исправление не подтверждено: "), rejected.toString());
        assertEquals(1, ok(rest.getForEntity("/api/projects/" + bad + "/analysis", String.class)).get("version").asInt());
    }
}
