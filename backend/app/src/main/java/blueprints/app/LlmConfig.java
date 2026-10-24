package blueprints.app;

import java.util.Map;

/**
 * Настройки LLM из env: {@code LLM_API_KEY}, {@code LLM_BASE_URL} (OpenAI-совместимый endpoint), {@code LLM_MODEL}.
 * Пустое значение — null: провайдер решает сам (endpoint и модель по умолчанию). Включён только при непустом ключе.
 */
record LlmConfig(String apiKey, String baseUrl, String model) {
    static LlmConfig fromEnv() {
        return from(System.getenv());
    }

    static LlmConfig from(Map<String, String> env) {
        return new LlmConfig(blankToNull(env.get("LLM_API_KEY")), blankToNull(env.get("LLM_BASE_URL")),
                blankToNull(env.get("LLM_MODEL")));
    }

    boolean enabled() {
        return apiKey != null;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }
}
