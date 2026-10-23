package blueprints.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/** Фикстуры контракта читаются в record'ы и пишутся обратно тем же JSON (NON_NULL, как в app). */
class ContractRoundTripTest {
    static final ObjectMapper M = new ObjectMapper().setSerializationInclusion(JsonInclude.Include.NON_NULL);
    static final Path FIX = Path.of("../../contract/fixtures");

    /** valueToTree даёт LongNode там, где парсер даёт IntNode, поэтому через текст. */
    static JsonNode rt(Object o) throws Exception {
        return M.readTree(M.writeValueAsString(o));
    }

    static JsonNode read(String name) throws Exception {
        return M.readTree(FIX.resolve(name).toFile());
    }

    /** Дефолты контракта, которые фикстура может опускать: issues=[], collapsed=false. */
    static void withBlockDefaults(JsonNode n) {
        ObjectNode o = (ObjectNode) n;
        if (!o.has("issues")) o.putArray("issues");
        if (!o.has("collapsed")) o.put("collapsed", false);
        o.get("slots").forEach(list -> list.forEach(ContractRoundTripTest::withBlockDefaults));
    }

    /** expected nullable и не required: отсутствие равно null. */
    static JsonNode expectedAsNull(JsonNode n) {
        ObjectNode o = n.deepCopy();
        if (!o.has("expected")) o.putNull("expected");
        return o;
    }

    @Test
    void block() throws Exception {
        JsonNode root = read("method-view.merge.json").get("root");
        JsonNode back = rt(M.treeToValue(root, Block.class));
        JsonNode expected = root.deepCopy();
        withBlockDefaults(expected);
        assertEquals(expected, back);
        assertEquals("[\"ISSUE-1\"]", back.at("/slots/body/1/slots/body/2/issues").toString());
    }

    @Test
    void issues() throws Exception {
        for (JsonNode n : read("analysis.merge.json").get("issues")) {
            assertEquals(n, rt(M.treeToValue(n, Issue.class)));
        }
    }

    @Test
    void ioTestCase() throws Exception {
        JsonNode io = read("project.json").get("tests").get(0);
        TestCase tc = M.treeToValue(io, TestCase.class);
        assertNull(tc.expected());
        assertEquals("CUSTOMER 1 Alice gold\n", tc.stdin());
        assertEquals("original", tc.mode());
        assertEquals(expectedAsNull(io), expectedAsNull(rt(tc)));
    }

    @Test
    void junitTestCaseAndResults() throws Exception {
        JsonNode tc = read("test.junit.json");
        assertEquals(tc, rt(M.treeToValue(tc, TestCase.class)));
        for (JsonNode n : read("verify.red.json").get("results")) {
            assertEquals(n, rt(M.treeToValue(n, TestResult.class)));
        }
    }
}
