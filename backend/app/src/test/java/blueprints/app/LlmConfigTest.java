package blueprints.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;

class LlmConfigTest {
    @Test
    void blankEnvIsDisabledWithProviderDefaults() {
        LlmConfig c = LlmConfig.from(Map.of("LLM_API_KEY", " ", "LLM_BASE_URL", ""));
        assertFalse(c.enabled());
        assertNull(c.baseUrl());
        assertNull(c.model());
    }

    @Test
    void readsAllThree() {
        LlmConfig c = LlmConfig.from(Map.of("LLM_API_KEY", "k", "LLM_BASE_URL", "http://x/v1", "LLM_MODEL", "m"));
        assertTrue(c.enabled());
        assertEquals(new LlmConfig("k", "http://x/v1", "m"), c);
    }
}
