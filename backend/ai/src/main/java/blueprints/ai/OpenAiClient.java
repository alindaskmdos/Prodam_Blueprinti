package blueprints.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/** OpenAI-совместимый chat completions: {@code POST {baseUrl}/chat/completions}, ключ в {@code Authorization: Bearer}. */
public final class OpenAiClient implements LlmClient {
    public static final String DEFAULT_BASE_URL = "https://api.openai.com/v1";
    public static final String DEFAULT_MODEL = "gpt-4o-mini";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final String apiKey;
    private final URI endpoint;
    private final String model;

    /** baseUrl / model null — значения по умолчанию. */
    public OpenAiClient(String apiKey, String baseUrl, String model) {
        this.apiKey = apiKey;
        String base = baseUrl == null ? DEFAULT_BASE_URL : baseUrl.replaceAll("/+$", "");
        this.endpoint = URI.create(base + "/chat/completions");
        this.model = model == null ? DEFAULT_MODEL : model;
    }

    @Override
    public String chat(String system, String user) {
        ObjectNode body = JSON.createObjectNode().put("model", model).put("temperature", 0.2);
        var messages = body.putArray("messages");
        messages.addObject().put("role", "system").put("content", system);
        messages.addObject().put("role", "user").put("content", user);
        try {
            HttpRequest req = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(90))
                    .header("Authorization", "Bearer " + apiKey).header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body), StandardCharsets.UTF_8)).build();
            HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (r.statusCode() / 100 != 2) throw new Unavailable("провайдер ИИ ответил HTTP " + r.statusCode());
            JsonNode content = JSON.readTree(r.body()).path("choices").path(0).path("message").path("content");
            if (!content.isTextual() || content.asText().isBlank()) throw new Unavailable("провайдер ИИ вернул пустой ответ");
            return content.asText();
        } catch (IOException e) {
            throw new Unavailable("провайдер ИИ не ответил: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new Unavailable("запрос к ИИ прерван");
        }
    }
}
