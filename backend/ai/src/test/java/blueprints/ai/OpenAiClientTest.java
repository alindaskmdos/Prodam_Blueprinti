package blueprints.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Формат chat completions на локальном HTTP-сервере (без внешней сети). */
class OpenAiClientTest {
    HttpServer server;
    final AtomicReference<String> body = new AtomicReference<>();
    final AtomicReference<String> auth = new AtomicReference<>();
    volatile int status = 200;
    volatile String reply = "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"привет\"}}]}";

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/v1/chat/completions", ex -> {
            body.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            auth.set(ex.getRequestHeaders().getFirst("Authorization"));
            byte[] out = reply.getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(status, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    OpenAiClient client() {
        return new OpenAiClient("k", "http://127.0.0.1:" + server.getAddress().getPort() + "/v1/", "m1");
    }

    @Test
    void sendsModelAndMessagesAndReadsContent() {
        assertEquals("привет", client().chat("sys", "usr"));
        assertEquals("Bearer k", auth.get());
        assertTrue(body.get().contains("\"model\":\"m1\""), body.get());
        assertTrue(body.get().contains("{\"role\":\"system\",\"content\":\"sys\"}"), body.get());
        assertTrue(body.get().contains("{\"role\":\"user\",\"content\":\"usr\"}"), body.get());
    }

    @Test
    void httpErrorAndEmptyAndNoServerAreUnavailable() {
        status = 401;
        assertTrue(assertThrows(LlmClient.Unavailable.class, () -> client().chat("s", "u")).getMessage().contains("401"));
        status = 200;
        reply = "{\"choices\":[]}";
        assertThrows(LlmClient.Unavailable.class, () -> client().chat("s", "u"));
        OpenAiClient dead = client();
        server.stop(0);
        assertThrows(LlmClient.Unavailable.class, () -> dead.chat("s", "u"));
    }
}
