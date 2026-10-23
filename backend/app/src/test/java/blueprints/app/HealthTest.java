package blueprints.app;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class HealthTest {
    @Autowired
    TestRestTemplate rest;

    @Test
    void healthIsOk() {
        assertEquals("{\"status\":\"ok\"}", rest.getForObject("/api/health", String.class));
    }
}
