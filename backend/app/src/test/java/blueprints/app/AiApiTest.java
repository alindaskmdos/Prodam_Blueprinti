package blueprints.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import blueprints.ai.Ai;
import blueprints.ai.LlmClient;
import blueprints.ai.RateLimiter;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.function.UnaryOperator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/** ИИ-эндпоинты с фейковым LLM (без сети): ответы по схемам контракта, лимиты, 422, Quality Gate у ai-fix. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AiApiTest {
    static final String MERGE = "com.demo.service.OrderService.merge~0";
    static final String PATH = "src/com/demo/service/OrderService.java";
    static final Pattern CODE = Pattern.compile("```java\\n(.*?)\\n```", Pattern.DOTALL);

    /** Ответ фейка по user-промпту; null — провайдер «не ответил». */
    static volatile UnaryOperator<String> reply;

    @TestConfiguration
    static class FakeLlm {
        @Bean
        @Primary
        Ai fakeAi() {
            return new Ai(new LlmClient() {
                @Override
                public String chat(String system, String user) {
                    if (reply == null) throw new LlmClient.Unavailable("провайдер ИИ не ответил: тест");
                    return reply.apply(user);
                }
            });
        }

        @Bean
        @Primary
        RateLimiter fakeLimiter() {
            return new RateLimiter(3, 1000, System::currentTimeMillis);
        }
    }

    @Autowired
    TestRestTemplate rest;

    String session;

    @BeforeEach
    void freshSession() {
        session = UUID.randomUUID().toString();
        reply = u -> "**Что делает.** сливает заказы";
    }

    /** Метод из промпта (первый блок java) с заменой. */
    static UnaryOperator<String> echo(String from, String to) {
        return u -> {
            Matcher m = CODE.matcher(u);
            assertTrue(m.find(), u);
            return "```java\n" + m.group(1).replace(from, to) + "\n```";
        };
    }

    ResponseEntity<String> post(String path, JsonNode body) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.set("X-Session-Id", session);
        return rest.exchange(URI.create(rest.getRootUri() + path), HttpMethod.POST, new HttpEntity<>(body.toString(), h), String.class);
    }

    static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }

    JsonNode error(ResponseEntity<String> r, int status, String code) throws IOException {
        assertEquals(status, r.getStatusCode().value(), r.getBody());
        JsonNode e = Contract.JSON.readTree(r.getBody());
        Contract.validate("Error", e);
        assertEquals(code, e.get("code").asText(), r.getBody());
        return e;
    }

    @Test
    void capabilitiesOn() throws IOException {
        JsonNode c = ContractConformanceTest.ok(rest.getForEntity("/api/capabilities", String.class));
        Contract.validate("Capabilities", c);
        assertEquals("{\"llm\":true,\"features\":[\"explain\",\"fix\",\"edit-node\"],\"limits\":{\"perMinute\":3,\"perDay\":1000}}",
                c.toString());
    }

    @Test
    void explainThenRateLimitedThenUnavailable() throws IOException {
        String base = upload();
        var v1 = Contract.JSON.createObjectNode().put("version", 1);
        JsonNode ex = ContractConformanceTest.ok(post(base + "/methods/" + MERGE + "/explain", v1));
        Contract.validate("AiExplanation", ex);
        assertEquals(1, ex.get("version").asInt());
        assertEquals("**Что делает.** сливает заказы", ex.get("text").asText());

        error(post(base + "/methods/" + MERGE + "/explain", Contract.JSON.createObjectNode().put("version", 5)), 409, "VERSION_CONFLICT");
        error(post(base + "/methods/com.demo.Nope.x~0/explain", v1), 404, "NOT_FOUND");
        reply = null;
        error(post(base + "/methods/" + MERGE + "/explain", v1), 503, "LLM_UNAVAILABLE");
        reply = u -> "ok";
        post(base + "/methods/" + MERGE + "/explain", v1); // третий засчитанный в минуту
        JsonNode limited = error(post(base + "/methods/" + MERGE + "/explain", v1), 429, "RATE_LIMITED");
        assertTrue(limited.get("details").get("retryAfterSec").asInt() > 0, limited.toString());
        assertTrue(limited.get("message").asText().startsWith("Слишком много запросов к ИИ: не больше 3 в минуту"), limited.toString());
        session = UUID.randomUUID().toString(); // другая сессия — свой лимит
        ContractConformanceTest.ok(post(base + "/methods/" + MERGE + "/explain", v1));
    }

    @Test
    void aiEditProposesDiffWithoutChangingProject() throws IOException {
        String base = upload();
        JsonNode view = ContractConformanceTest.ok(rest.getForEntity(base + "/methods/" + MERGE + "/blocks", String.class));
        String blockId = view.get("root").get("slots").get("body").get(0).get("id").asText();
        String before = ContractConformanceTest.ok(rest.getForEntity(base + "/files?path={p}", String.class, PATH)).get("text").asText();
        reply = echo("int merged = 0;", "if (orders == null) {\n            return 0;\n        }\n        int merged = 0;");
        var body = Contract.JSON.createObjectNode().put("version", 1).put("blockId", blockId).put("instruction", "добавь проверку на null");
        JsonNode p = ContractConformanceTest.ok(post(base + "/methods/" + MERGE + "/ai-edit", body));
        Contract.validate("AiEditProposal", p);
        assertEquals(1, p.get("version").asInt());
        assertEquals(PATH, p.get("path").asText());
        String text = p.get("text").asText();
        assertTrue(text.contains("        if (orders == null) {\n            return 0;\n        }\n        int merged = 0;"), text);
        // вне merge — байт в байт
        int at = before.indexOf("public int merge()");
        assertTrue(text.startsWith(before.substring(0, at)));
        String tail = before.substring(before.indexOf("\n    }\n", before.indexOf("int merged = 0;")));
        assertTrue(text.endsWith(tail), text);
        assertTrue(p.get("diff").asText().startsWith("--- a/" + PATH + "\n+++ b/" + PATH + "\n@@ "), p.get("diff").asText());
        assertTrue(p.get("diff").asText().contains("\n+        if (orders == null) {\n"), p.get("diff").asText());
        JsonNode file = ContractConformanceTest.ok(rest.getForEntity(base + "/files?path={p}", String.class, PATH));
        assertEquals(1, file.get("version").asInt()); // проект не изменился
        assertEquals(before, file.get("text").asText());

        reply = u -> "Не могу.";
        assertEquals(422, post(base + "/methods/" + MERGE + "/ai-edit", body).getStatusCode().value());
        error(post(base + "/methods/" + MERGE + "/ai-edit", body.deepCopy().put("blockId", "nope")), 404, "NOT_FOUND");
        // id метода — правка всего метода
        reply = echo("int merged = 0;", "int merged = 0; // ии");
        JsonNode whole = ContractConformanceTest.ok(post(base + "/methods/" + MERGE + "/ai-edit", body.deepCopy().put("blockId", MERGE)));
        assertTrue(whole.get("text").asText().contains("int merged = 0; // ии"));
    }

    @Test
    void aiEditUnparsableIsParseError() throws IOException {
        String base = upload();
        reply = u -> "```java\nint x = ;\n```";
        var body = Contract.JSON.createObjectNode().put("version", 1).put("blockId", MERGE).put("instruction", "x");
        error(post(base + "/methods/" + MERGE + "/ai-edit", body), 422, "PARSE_ERROR");
    }

    @Test
    void aiFixWithHashMapIsRejectedByGate() throws IOException {
        String base = upload();
        reply = echo("int merged = 0;", "java.util.Map<Integer, Integer> seen = new java.util.HashMap<>();\n        int merged = 0;");
        JsonNode r = ContractConformanceTest.ok(post(base + "/issues/" + enc(mergeIssue(base)) + "/ai-fix",
                Contract.JSON.createObjectNode().put("version", 1)));
        Contract.validate("FixResult", r);
        assertFalse(r.get("applied").asBoolean(), r.toString());
        assertEquals(1, r.get("version").asInt());
        assertTrue(r.get("reason").asText().contains("LinkedHashMap/LinkedHashSet"), r.toString());
        error(post(base + "/issues/nope/ai-fix", Contract.JSON.createObjectNode().put("version", 1)), 404, "NOT_FOUND");
        error(post(base + "/issues/" + enc(mergeIssue(base)) + "/ai-fix", Contract.JSON.createObjectNode().put("version", 2)),
                409, "VERSION_CONFLICT");
    }

    /** Quality Gate в Docker: правка без смены поведения применяется (version+1, diff), как applyFix. */
    @Test
    void aiFixAppliedThroughQualityGateInDocker() throws IOException {
        assumeTrue(TestsApiTest.dockerUp(), "docker недоступен");
        String base = upload();
        reply = echo("int merged = 0;", "int merged = 0; // счётчик слияний");
        JsonNode r = ContractConformanceTest.ok(post(base + "/issues/" + enc(mergeIssue(base)) + "/ai-fix",
                Contract.JSON.createObjectNode().put("version", 1)));
        Contract.validate("FixResult", r);
        assertTrue(r.get("applied").asBoolean(), r.toString());
        assertEquals(2, r.get("version").asInt());
        assertEquals("green", r.get("verify").get("status").asText(), r.toString());
        assertTrue(r.get("diff").asText().contains("+        int merged = 0; // счётчик слияний"), r.toString());
        JsonNode file = ContractConformanceTest.ok(rest.getForEntity(base + "/files?path={p}", String.class, PATH));
        assertEquals(2, file.get("version").asInt());
    }

    String upload() throws IOException {
        org.springframework.util.MultiValueMap<String, Object> body = new org.springframework.util.LinkedMultiValueMap<>();
        ProjectsApiTest.demoFiles().forEach((path, data) -> {
            body.add("files", ProjectsApiTest.part(path.replaceAll(".*/", ""), data));
            body.add("paths", path);
        });
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.MULTIPART_FORM_DATA);
        var created = rest.postForEntity("/api/projects", new HttpEntity<>(body, h), String.class);
        assertEquals(201, created.getStatusCode().value(), created.getBody());
        return "/api/projects/" + Contract.JSON.readTree(created.getBody()).get("id").asText();
    }

    String mergeIssue(String base) throws IOException {
        for (JsonNode i : ContractConformanceTest.ok(rest.getForEntity(base + "/analysis", String.class)).get("issues")) {
            if (MERGE.equals(i.path("methodId").asText()) && i.get("rule").asText().equals("NestedLoopSameCollection")) {
                return i.get("id").asText();
            }
        }
        throw new AssertionError("нет NestedLoopSameCollection в merge");
    }
}
