package blueprints.app;

import static org.junit.jupiter.api.Assertions.assertEquals;

import blueprints.app.ProjectDto.FileDto;
import blueprints.app.ProjectDto.TestCaseDto;
import blueprints.source.LoadWarning;
import blueprints.source.ProjectLoader;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Фикстуры валидны схеме, а наши DTO сериализуются в ту же форму, что фикстура project.json. */
class ContractConformanceTest {
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
