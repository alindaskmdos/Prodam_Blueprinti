package blueprints.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.StreamSupport;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
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

/** GET/PUT/DELETE /projects/{id}/pmd-config (§14а.2): ответы по схемам контракта, версия, 422/409, экспорт и импорт с zip. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PmdConfigApiTest {
    static final String CUSTOM = """
            <?xml version="1.0" encoding="UTF-8"?>
            <ruleset name="custom" xmlns="http://pmd.sourceforge.net/ruleset/2.0.0">
                <description>custom</description>
                <rule ref="category/java/codestyle.xml/LocalVariableCouldBeFinal"/>
            </ruleset>
            """;

    /** violationSuppressXPath — стандартное свойство любого правила, тоже исполняется Saxon. */
    static final String SUPPRESS_XPATH = """
            <?xml version="1.0"?>
            <ruleset name="s" xmlns="http://pmd.sourceforge.net/ruleset/2.0.0">
                <description>s</description>
                <rule ref="category/java/bestpractices.xml/UnusedPrivateField">
                    <properties>
                        <property name="violationSuppressXPath" value="doc('http://169.254.169.254/latest')"/>
                    </properties>
                </rule>
            </ruleset>
            """;

    /** Тот же violationSuppressXPath атрибутом прямо на <rule>. */
    static final String SUPPRESS_ATTR = """
            <?xml version="1.0"?>
            <ruleset name="s" xmlns="http://pmd.sourceforge.net/ruleset/2.0.0">
                <description>s</description>
                <rule ref="category/java/bestpractices.xml/UnusedPrivateField" violationSuppressXPath="doc('http://169.254.169.254/latest')"/>
            </ruleset>
            """;

    @Autowired
    TestRestTemplate rest;

    String upload(Map<String, byte[]> files) throws IOException {
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("files", ProjectsApiTest.part("demo.zip", ProjectsApiTest.zip(files)));
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.MULTIPART_FORM_DATA);
        var r = rest.postForEntity("/api/projects", new HttpEntity<>(body, h), String.class);
        assertEquals(HttpStatus.CREATED, r.getStatusCode(), r.getBody());
        return json(r.getBody()).get("id").asText();
    }

    ResponseEntity<String> put(String id, Object version, String xml) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("version", version);
        body.put("xml", xml);
        return rest.exchange(URI.create(rest.getRootUri() + "/api/projects/" + id + "/pmd-config"), HttpMethod.PUT,
                new HttpEntity<>(Contract.JSON.valueToTree(body).toString(), h), String.class);
    }

    ResponseEntity<String> delete(String id, int version) {
        return rest.exchange(URI.create(rest.getRootUri() + "/api/projects/" + id + "/pmd-config?version=" + version),
                HttpMethod.DELETE, null, String.class);
    }

    static JsonNode json(String s) throws IOException {
        return Contract.JSON.readTree(s);
    }

    static JsonNode ok(ResponseEntity<String> r) throws IOException {
        assertEquals(HttpStatus.OK, r.getStatusCode(), r.getBody());
        return json(r.getBody());
    }

    JsonNode get(String id) throws IOException {
        JsonNode cfg = ok(rest.getForEntity("/api/projects/" + id + "/pmd-config", String.class));
        Contract.validateResponse("/projects/{projectId}/pmd-config", "get", "200", cfg);
        Contract.validate("PmdConfig", cfg);
        return cfg;
    }

    @Test
    void defaultPutResetAndAnalysis() throws IOException {
        String id = upload(ProjectsApiTest.demoFiles());

        JsonNode def = get(id);
        assertEquals(Contract.fixture("pmd-config.default.json"), def);

        // стандартный набор уже в анализе: находки PMD с source=PMD
        JsonNode analysis = ok(rest.getForEntity("/api/projects/" + id + "/analysis", String.class));
        Contract.validate("Analysis", analysis);

        JsonNode put = ok(put(id, 1, CUSTOM));
        Contract.validateResponse("/projects/{projectId}/pmd-config", "put", "200", put);
        Contract.validate("PmdConfigMutationResult", put);
        assertEquals(2, put.get("version").asInt());
        assertFalse(put.get("isDefault").asBoolean());
        assertEquals(2, put.get("analysis").get("version").asInt());
        JsonNode pmd = StreamSupport.stream(put.get("analysis").get("issues").spliterator(), false)
                .filter(i -> i.get("rule").asText().equals("LocalVariableCouldBeFinal")).findFirst().orElseThrow();
        assertEquals("PMD", pmd.get("source").asText());
        assertNotNull(pmd.get("methodId"), pmd.toString());
        assertNotNull(pmd.get("blockId"), pmd.toString()); // привязка к ноде по строке
        assertTrue(StreamSupport.stream(put.get("analysis").get("issues").spliterator(), false)
                .filter(i -> i.get("source").asText().equals("PMD"))
                .allMatch(i -> i.get("rule").asText().equals("LocalVariableCouldBeFinal")));
        // нода метода знает id находки PMD
        String method = pmd.get("methodId").asText();
        JsonNode view = ok(rest.getForEntity("/api/projects/" + id + "/methods/" + method + "/blocks", String.class));
        assertTrue(view.toString().contains(pmd.get("id").asText()));

        JsonNode cfg = get(id);
        assertEquals(CUSTOM, cfg.get("xml").asText());
        assertFalse(cfg.get("isDefault").asBoolean());
        assertEquals(2, cfg.get("version").asInt());

        // битый XML и неизвестное правило — 422 INVALID_RULESET со строкой, конфиг и версия прежние
        var broken = put(id, 2, "<?xml version=\"1.0\"?>\n<ruleset>\n<rule ref=\"category/java/errorprone.xml\">\n</ruleset>");
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, broken.getStatusCode(), broken.getBody());
        Contract.validate("Error", json(broken.getBody()));
        assertEquals("INVALID_RULESET", json(broken.getBody()).get("code").asText());
        assertEquals(4, json(broken.getBody()).get("line").asInt());
        var unknown = put(id, 2, CUSTOM.replace("LocalVariableCouldBeFinal", "NoSuchRule"));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, unknown.getStatusCode(), unknown.getBody());
        assertEquals("INVALID_RULESET", json(unknown.getBody()).get("code").asText());
        assertEquals(4, json(unknown.getBody()).get("line").asInt());
        assertTrue(json(unknown.getBody()).get("message").asText().contains("NoSuchRule"));
        var remote = put(id, 2, CUSTOM.replace("category/java/codestyle.xml/LocalVariableCouldBeFinal", "https://example.com/r.xml"));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, remote.getStatusCode(), remote.getBody());
        // свои XPath-правила (Saxon читает файлы и URL) — 422 со строкой
        for (String fn : List.of("unparsed-text('file:///etc/passwd') != ''", "doc('http://169.254.169.254/latest')")) {
            var leak = put(id, 2, xpathRule(fn));
            assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, leak.getStatusCode(), leak.getBody());
            assertEquals("INVALID_RULESET", json(leak.getBody()).get("code").asText());
            assertEquals(4, json(leak.getBody()).get("line").asInt());
        }
        for (String rs : List.of(SUPPRESS_XPATH, SUPPRESS_ATTR)) {
            var suppress = put(id, 2, rs);
            assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, suppress.getStatusCode(), suppress.getBody());
            assertEquals("INVALID_RULESET", json(suppress.getBody()).get("code").asText());
            assertEquals(rs == SUPPRESS_XPATH ? 6 : 4, json(suppress.getBody()).get("line").asInt());
        }
        assertEquals(CUSTOM, get(id).get("xml").asText());
        assertEquals(2, get(id).get("version").asInt());

        // старая версия — 409, без version — 400
        var stale = put(id, 1, CUSTOM);
        assertEquals(HttpStatus.CONFLICT, stale.getStatusCode(), stale.getBody());
        assertEquals("VERSION_CONFLICT", json(stale.getBody()).get("code").asText());
        assertEquals(HttpStatus.BAD_REQUEST, put(id, null, CUSTOM).getStatusCode());
        assertEquals(HttpStatus.CONFLICT, delete(id, 1).getStatusCode());

        JsonNode reset = ok(delete(id, 2));
        Contract.validateResponse("/projects/{projectId}/pmd-config", "delete", "200", reset);
        assertEquals(3, reset.get("version").asInt());
        assertTrue(reset.get("isDefault").asBoolean());
        assertTrue(get(id).get("isDefault").asBoolean());
        assertEquals(def.get("xml"), get(id).get("xml"));

        assertEquals(HttpStatus.NOT_FOUND, rest.getForEntity("/api/projects/nope/pmd-config", String.class).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND, put("nope", 1, CUSTOM).getStatusCode());
    }

    /** Конфиг уходит в zip (includeSettings) и возвращается при загрузке этого zip; битый конфиг при загрузке — предупреждение. */
    @Test
    void exportedWithProjectAndImportedBack() throws IOException {
        String id = upload(ProjectsApiTest.demoFiles());
        ok(put(id, 1, CUSTOM));
        byte[] zip = rest.getForObject("/api/projects/" + id + "/export?format=zip", byte[].class);
        Map<String, byte[]> entries = unzip(zip);
        assertEquals(CUSTOM, new String(entries.get("demo/.blueprints/pmd-ruleset.xml"), StandardCharsets.UTF_8));
        assertTrue(entries.containsKey("demo/src/com/demo/Main.java"), entries.keySet().toString());
        byte[] plain = rest.getForObject("/api/projects/" + id + "/export?format=zip&includeSettings=false", byte[].class);
        assertFalse(unzip(plain).containsKey("demo/.blueprints/pmd-ruleset.xml"));

        String again = upload(entries);
        JsonNode cfg = get(again);
        assertFalse(cfg.get("isDefault").asBoolean());
        assertEquals(CUSTOM, cfg.get("xml").asText());

        for (String bad : List.of("<ruleset>", xpathRule("unparsed-text-available('file:///etc/hostname') or true()"), SUPPRESS_XPATH,
                SUPPRESS_ATTR)) {
            entries.put("demo/.blueprints/pmd-ruleset.xml", bad.getBytes(StandardCharsets.UTF_8));
            String broken = upload(entries);
            assertTrue(get(broken).get("isDefault").asBoolean());
            JsonNode project = ok(rest.getForEntity("/api/projects/" + broken, String.class));
            Contract.validate("Project", project);
            assertTrue(project.get("warnings").toString().contains(".blueprints/pmd-ruleset.xml"), project.get("warnings").toString());
            // правило из zip не исполняется: находок Leak нет (с xpath «or true()» были бы на каждом классе)
            JsonNode analysis = ok(rest.getForEntity("/api/projects/" + broken + "/analysis", String.class));
            assertFalse(analysis.toString().contains("\"Leak\""), analysis.toString());
        }
    }

    static String xpathRule(String condition) {
        return """
                <?xml version="1.0"?>
                <ruleset name="x" xmlns="http://pmd.sourceforge.net/ruleset/2.0.0">
                    <description>x</description>
                    <rule name="Leak" language="java" message="m" class="net.sourceforge.pmd.lang.rule.xpath.XPathRule">
                        <priority>1</priority>
                        <properties><property name="xpath"><value><![CDATA[//ClassDeclaration[%s]]]></value></property></properties>
                    </rule>
                </ruleset>
                """.formatted(condition);
    }

    static Map<String, byte[]> unzip(byte[] zip) throws IOException {
        Map<String, byte[]> m = new LinkedHashMap<>();
        try (ZipInputStream z = new ZipInputStream(new ByteArrayInputStream(zip))) {
            for (ZipEntry e; (e = z.getNextEntry()) != null; ) m.put(e.getName(), z.readAllBytes());
        }
        return m;
    }
}
