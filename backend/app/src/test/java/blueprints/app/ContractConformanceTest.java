package blueprints.app;

import static org.junit.jupiter.api.Assertions.assertEquals;

import blueprints.app.ProjectDto.FileDto;
import blueprints.app.ProjectDto.TestCaseDto;
import blueprints.source.LoadWarning;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Фикстуры валидны схеме, а наши DTO сериализуются в ту же форму, что фикстура project.json. */
class ContractConformanceTest {
    @Test
    void fixturesMatchSchemas() throws IOException {
        Contract.validate("Project", Contract.fixture("project.json"));
        Contract.validate("ProjectTree", Contract.fixture("tree.json"));
        Contract.validate("Error", Contract.fixture("error.conflict.json"));
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
