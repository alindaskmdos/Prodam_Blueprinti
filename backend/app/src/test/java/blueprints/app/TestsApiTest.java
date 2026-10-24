package blueprints.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

/** GET/PUT/DELETE tests, POST run/verify. Запуски в Docker пропускаются, если docker info не проходит. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class TestsApiTest {
    static final String MAIN = "public class Main {\n    public static void main(String[] a) {\n"
            + "        System.out.println(new java.util.Scanner(System.in).nextLine().toUpperCase());\n    }\n}\n";
    static final String JUNIT = "import org.junit.jupiter.api.Test;\n\nclass MainTest {\n    @Test\n    void ok() {}\n}\n";

    @Autowired
    TestRestTemplate rest;

    String upload(Map<String, String> files) throws IOException {
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        files.forEach((path, text) -> {
            body.add("files", ProjectsApiTest.part(path.replaceAll(".*/", ""), text.getBytes(StandardCharsets.UTF_8)));
            body.add("paths", path);
        });
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.MULTIPART_FORM_DATA);
        var r = rest.postForEntity("/api/projects", new HttpEntity<>(body, h), String.class);
        assertEquals(HttpStatus.CREATED, r.getStatusCode(), r.getBody());
        return json(r.getBody()).get("id").asText();
    }

    static JsonNode json(String s) throws IOException {
        return Contract.JSON.readTree(s);
    }

    ResponseEntity<String> call(HttpMethod method, String url, Object body) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        String text = body == null ? null : body instanceof String s ? s : Contract.JSON.valueToTree(body).toString();
        return rest.exchange(URI.create(rest.getRootUri() + url), method, new HttpEntity<>(text, h), String.class);
    }

    void assertError(ResponseEntity<String> r, HttpStatus status, String code) throws IOException {
        assertEquals(status, r.getStatusCode(), r.getBody());
        JsonNode err = json(r.getBody());
        Contract.validate("Error", err);
        assertEquals(code, err.get("code").asText());
    }

    static Map<String, Object> io(String name, String stdin) {
        return io(name, stdin, 1);
    }

    static Map<String, Object> io(String name, String stdin, int version) {
        Map<String, Object> t = new LinkedHashMap<>();
        t.put("version", version);
        t.put("name", name);
        t.put("type", "io");
        t.put("stdin", stdin);
        return t;
    }

    @Test
    void crudChangesVersionAndValidatesSchemas() throws IOException {
        String id = upload(Map.of("Main.java", MAIN, "tests/pair.in", "a\n", "tests/pair.out", "A\n"));
        String base = "/api/projects/" + id + "/tests";

        JsonNode list = json(rest.getForObject(base, String.class));
        assertEquals(1, list.size());
        Contract.validate("TestCase", list.get(0));
        assertEquals("manual", list.get(0).get("mode").asText()); // пара .in/.out — как её гоняет IoTestSource

        var put = call(HttpMethod.PUT, base + "/hello", io("hello", "hi\n"));
        assertEquals(HttpStatus.OK, put.getStatusCode(), put.getBody());
        JsonNode m = json(put.getBody());
        Contract.validate("TestMutationResult", m);
        assertEquals(2, m.get("version").asInt());
        assertEquals("original", m.get("test").get("mode").asText());

        Map<String, Object> junit = Map.of("name", "MainTest", "type", "junit", "source", JUNIT, "version", 2);
        JsonNode j = json(call(HttpMethod.PUT, base + "/MainTest", junit).getBody());
        Contract.validate("TestMutationResult", j);
        assertEquals(3, j.get("version").asInt());
        assertEquals(JUNIT, j.get("test").get("source").asText());

        JsonNode one = json(rest.getForObject(base + "/MainTest", String.class));
        Contract.validate("TestCase", one);
        assertEquals(List.of("MainTest", "hello", "pair"),
                json(rest.getForObject(base, String.class)).findValuesAsText("name"));

        // pair -> json: пара .in/.out заменяется файлом tests/pair.json
        var over = call(HttpMethod.PUT, base + "/pair", io("pair", "b\n", 3));
        assertEquals("b\n", json(over.getBody()).get("test").get("stdin").asText());
        assertEquals(4, json(over.getBody()).get("version").asInt());

        var del = call(HttpMethod.DELETE, base + "/hello?version=4", null);
        assertEquals(HttpStatus.OK, del.getStatusCode(), del.getBody());
        assertEquals(5, json(del.getBody()).get("version").asInt());
        assertError(rest.exchange(URI.create(rest.getRootUri() + base + "/hello"), HttpMethod.GET, null, String.class),
                HttpStatus.NOT_FOUND, "NOT_FOUND");
        assertError(call(HttpMethod.DELETE, base + "/hello?version=5", null), HttpStatus.NOT_FOUND, "NOT_FOUND");
        assertEquals(5, json(rest.getForObject("/api/projects/" + id, String.class)).get("version").asInt());
    }

    @Test
    void invalidTestsAndStaleVersion() throws IOException {
        String id = upload(Map.of("Main.java", MAIN));
        String base = "/api/projects/" + id + "/tests";
        assertError(call(HttpMethod.PUT, base + "/a", io("b", "")), HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_REQUEST");
        assertError(call(HttpMethod.PUT, base + "/a", io("", "")), HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_REQUEST");
        Map<String, Object> manual = io("a", "");
        manual.put("mode", "manual"); // без expected
        assertError(call(HttpMethod.PUT, base + "/a", manual), HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_REQUEST");
        var broken = call(HttpMethod.PUT, base + "/T", Map.of("name", "T", "type", "junit", "source", "class T {\n  void x( {}\n}\n", "version", 1));
        assertError(broken, HttpStatus.UNPROCESSABLE_ENTITY, "PARSE_ERROR");
        assertEquals(2, json(broken.getBody()).get("line").asInt());

        Map<String, Object> stale = io("a", "");
        stale.put("version", 7);
        var conflict = call(HttpMethod.PUT, base + "/a", stale);
        assertError(conflict, HttpStatus.CONFLICT, "VERSION_CONFLICT");
        assertEquals(1, json(conflict.getBody()).get("details").get("serverVersion").asInt());
        assertEquals(HttpStatus.OK, call(HttpMethod.PUT, base + "/a", io("a", "")).getStatusCode());
        Map<String, Object> noVersion = io("a", "");
        noVersion.remove("version");
        assertError(call(HttpMethod.PUT, base + "/a", noVersion), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertError(call(HttpMethod.DELETE, base + "/a", null), HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
        assertError(call(HttpMethod.DELETE, base + "/a?version=1", null), HttpStatus.CONFLICT, "VERSION_CONFLICT");
        assertEquals(3, json(call(HttpMethod.DELETE, base + "/a?version=2", null).getBody()).get("version").asInt());
        assertError(call(HttpMethod.GET, "/api/projects/nope/tests", null), HttpStatus.NOT_FOUND, "NOT_FOUND");
    }

    @Test
    void invalidNamesRejected() throws IOException {
        String base = "/api/projects/" + upload(Map.of("Main.java", MAIN)) + "/tests";
        for (String bad : List.of("a..b", "-x", ".hidden", "a%20b")) {
            assertError(call(HttpMethod.PUT, base + "/" + bad, io(bad.replace("%20", " "), "")),
                    HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_REQUEST");
            assertError(call(HttpMethod.DELETE, base + "/" + bad + "?version=1", null), HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_REQUEST");
            assertError(call(HttpMethod.GET, base + "/" + bad, null), HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_REQUEST");
        }
    }

    /** X.json и X.java одновременно: в списке оба, GET X — 422, PUT оставляет один вид, DELETE убирает оба. */
    @Test
    void sameNameIoAndJunit() throws IOException {
        Map<String, String> files = Map.of("Main.java", MAIN, "tests/X.json", "{\"stdin\": \"\"}", "tests/X.java", JUNIT);
        String base = "/api/projects/" + upload(files) + "/tests";
        JsonNode list = json(rest.getForObject(base, String.class));
        assertEquals(List.of("X", "X"), list.findValuesAsText("name"));
        assertEquals(List.of("io", "junit"), list.findValuesAsText("type"));
        assertError(call(HttpMethod.GET, base + "/X", null), HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_REQUEST");

        var put = call(HttpMethod.PUT, base + "/X", io("X", "1\n"));
        assertEquals(HttpStatus.OK, put.getStatusCode(), put.getBody());
        assertEquals(List.of("io"), json(rest.getForObject(base, String.class)).findValuesAsText("type"));

        String other = "/api/projects/" + upload(files) + "/tests";
        assertEquals(HttpStatus.OK, call(HttpMethod.DELETE, other + "/X?version=1", null).getStatusCode());
        assertEquals(0, json(rest.getForObject(other, String.class)).size());
    }

    @Test
    void runAndVerifyWithoutDocker() throws IOException {
        String two = upload(Map.of("A.java", "class A { public static void main(String[] a) {} }\n",
                "B.java", "class B { public static void main(String[] a) {} }\n", "tests/t.json", "{}"));
        var amb = call(HttpMethod.POST, "/api/projects/" + two + "/run", Map.of("stdin", ""));
        assertError(amb, HttpStatus.UNPROCESSABLE_ENTITY, "AMBIGUOUS_MAIN");
        JsonNode mains = json(amb.getBody()).get("details").get("mainClasses");
        assertEquals(List.of("A", "B"), List.of(mains.get(0).asText(), mains.get(1).asText()));

        var unknown = call(HttpMethod.POST, "/api/projects/" + two + "/run", Map.of("mainClass", "C"));
        assertError(unknown, HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_REQUEST");
        assertTrue(json(unknown.getBody()).get("message").asText().contains("C"));
        assertError(call(HttpMethod.POST, "/api/projects/" + two + "/verify", null), HttpStatus.UNPROCESSABLE_ENTITY,
                "AMBIGUOUS_MAIN");

        // несколько main только в оригинале: текущая правится до одного main
        String orig = upload(Map.of("A.java", "class A { public static void main(String[] a) {} }\n",
                "B.java", "class B { public static void main(String[] a) {} }\n", "tests/t.json", "{}"));
        assertEquals(HttpStatus.OK, call(HttpMethod.PUT, "/api/projects/" + orig + "/files?path=B.java",
                Map.of("version", 1, "text", "class B {}\n")).getStatusCode());
        var origAmb = call(HttpMethod.POST, "/api/projects/" + orig + "/verify", null);
        assertError(origAmb, HttpStatus.UNPROCESSABLE_ENTITY, "AMBIGUOUS_MAIN");

        // несколько main без IO-тестов: mainClass не нужен — verify идёт (тестов нет -> incomplete)
        String manyNoIo = upload(Map.of("A.java", "class A { public static void main(String[] a) {} }\n",
                "B.java", "class B { public static void main(String[] a) {} }\n"));
        var ok = call(HttpMethod.POST, "/api/projects/" + manyNoIo + "/verify", null);
        assertEquals(HttpStatus.OK, ok.getStatusCode(), ok.getBody());
        Contract.validate("VerifyResult", json(ok.getBody()));
        assertEquals("incomplete", json(ok.getBody()).get("status").asText());

        // main нет, а IO-тест есть
        String noMain = upload(Map.of("A.java", "class A {}\n", "tests/t.json", "{\"stdin\": \"\"}"));
        var nm = call(HttpMethod.POST, "/api/projects/" + noMain + "/verify", null);
        assertError(nm, HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_REQUEST");
        assertTrue(json(nm.getBody()).get("message").asText().contains("main"));

        // тестов нет — запусков нет, Docker не нужен
        String id = upload(Map.of("A.java", "class A { public static void main(String[] a) {} }\n"));
        var v = call(HttpMethod.POST, "/api/projects/" + id + "/verify", null);
        assertEquals(HttpStatus.OK, v.getStatusCode(), v.getBody());
        JsonNode r = json(v.getBody());
        Contract.validate("VerifyResult", r);
        assertEquals("incomplete", r.get("status").asText());
        assertError(call(HttpMethod.POST, "/api/projects/nope/verify", null), HttpStatus.NOT_FOUND, "NOT_FOUND");
    }

    @Test
    void runAndVerifyInDocker() throws IOException {
        assumeTrue(dockerUp(), "docker недоступен");
        String id = upload(Map.of("src/Main.java", MAIN, "tests/up.json", "{\"stdin\": \"abc\\n\"}"));
        var run = call(HttpMethod.POST, "/api/projects/" + id + "/run", Map.of("stdin", "abc\n"));
        assertEquals(HttpStatus.OK, run.getStatusCode(), run.getBody());
        JsonNode r = json(run.getBody());
        Contract.validate("RunResult", r);
        assertEquals("ABC\n", r.get("stdout").asText());
        assertEquals(0, r.get("exitCode").asInt());

        JsonNode green = json(call(HttpMethod.POST, "/api/projects/" + id + "/verify", null).getBody());
        Contract.validate("VerifyResult", green);
        assertEquals("green", green.get("status").asText(), green.toString());

        String broken = MAIN.replace("toUpperCase()", "toLowerCase()");
        var edit = call(HttpMethod.PUT, "/api/projects/" + id + "/files?path=src/Main.java", Map.of("version", 1, "text", broken));
        assertEquals(HttpStatus.OK, edit.getStatusCode(), edit.getBody());
        assertEquals(2, json(edit.getBody()).get("version").asInt());
        JsonNode red = json(call(HttpMethod.POST, "/api/projects/" + id + "/verify", null).getBody());
        Contract.validate("VerifyResult", red);
        assertEquals("red", red.get("status").asText(), red.toString());
    }

    /** Битые tests/*.json не превращают проверку молча в «тестов нет»: warning на каждый, green не ставится. */
    @Test
    void brokenJsonTestsAreReportedByVerify() throws IOException {
        String id = upload(Map.of("A.java", "class A { public static void main(String[] a) {} }\n", "tests/bad.json", "{oops"));
        JsonNode r = json(call(HttpMethod.POST, "/api/projects/" + id + "/verify", null).getBody());
        Contract.validate("VerifyResult", r);
        assertEquals("incomplete", r.get("status").asText());
        assertTrue(r.get("warnings").toString().contains("tests/bad.json"), r.toString());

        assumeTrue(dockerUp(), "docker недоступен");
        String mixed = upload(Map.of("src/Main.java", MAIN, "tests/up.json", "{\"stdin\": \"abc\\n\"}", "tests/bad.json", "{oops"));
        JsonNode m = json(call(HttpMethod.POST, "/api/projects/" + mixed + "/verify", null).getBody());
        Contract.validate("VerifyResult", m);
        assertEquals("incomplete", m.get("status").asText(), m.toString()); // up прошёл бы green
        assertEquals("passed", m.get("results").get(0).get("status").asText(), m.toString());
        assertTrue(m.get("warnings").toString().contains("tests/bad.json"), m.toString());
    }

    @Test
    void compileErrorsWithoutDocker() throws IOException { // компиляция — в процессе сервера, до контейнера
        String id = upload(Map.of("src/Main.java", "public class Main {\n  public static void main(String[] a) { int x = \"s\"; }\n}\n",
                "lib/U.java", "class U {}\n")); // две папки — обёртка не отрезается
        JsonNode r = json(call(HttpMethod.POST, "/api/projects/" + id + "/run", null).getBody());
        Contract.validate("RunResult", r);
        assertEquals("src/Main.java", r.get("compileErrors").get(0).get("file").asText(), r.toString());
        assertEquals(2, r.get("compileErrors").get(0).get("line").asInt());
        assertTrue(r.get("compileErrors").get(0).get("message").asText().length() > 0);
    }

    static boolean dockerUp() {
        try {
            Process p = new ProcessBuilder("docker", "info").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            return p.waitFor() == 0;
        } catch (Exception e) {
            return false;
        }
    }
}
