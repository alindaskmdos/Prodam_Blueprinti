package blueprints.ai;

/** Запрос к модели: system + user → текст ответа. Реализация — {@link OpenAiClient}; в тестах — фейк. */
public interface LlmClient {
    /** @throws Unavailable провайдер не ответил / ответил ошибкой (LLM_UNAVAILABLE) */
    String chat(String system, String user);

    /** ИИ недоступен: нет ключа или провайдер не ответил. В app — 503 LLM_UNAVAILABLE. */
    final class Unavailable extends RuntimeException {
        public Unavailable(String message) {
            super(message);
        }
    }
}
