package blueprints.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.app.ProjectDto.FileDto;
import blueprints.app.ProjectDto.TestCaseDto;
import blueprints.source.LoadWarning;
import blueprints.source.ProjectLoader;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
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
}
