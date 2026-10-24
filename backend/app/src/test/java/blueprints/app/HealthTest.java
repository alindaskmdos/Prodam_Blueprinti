package blueprints.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class HealthTest {
    @Autowired
    TestRestTemplate rest;

    /** Ответ по схеме /health контракта; docker совпадает с `docker info`, llm — с LLM_API_KEY. */
    @Test
    void healthMatchesContract() throws Exception {
        JsonNode h = Contract.JSON.readTree(rest.getForObject("/api/health", String.class));
        Contract.validateResponse("/health", "get", "200", h);
        assertEquals("UP", h.get("status").asText());
        assertEquals(TestsApiTest.dockerUp(), h.get("docker").asBoolean());
        String key = System.getenv("LLM_API_KEY");
        assertEquals(key != null && !key.isBlank(), h.get("llm").asBoolean());
        assertEquals(LlmConfig.fromEnv().enabled(), h.get("llm").asBoolean());
    }

    @Test
    void missingDockerIsFalseNotError() {
        assertFalse(HealthController.dockerUp("no-such-docker-binary"));
    }
}
