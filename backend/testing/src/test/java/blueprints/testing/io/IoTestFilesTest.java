package blueprints.testing.io;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class IoTestFilesTest {

    @Test
    void parsesFullJson() {
        IoTestCase t = IoTestFiles.parse("merge", """
                {"name":"merge","stdin":"1\\n2\\n","mode":"manual","expected":"3\\n","ignoreLines":[2,5]}""");
        assertEquals(new IoTestCase("merge", "1\n2\n", IoTestCase.Mode.MANUAL, "3\n", List.of(2, 5)), t);
        assertEquals("io", t.type());
    }

    @Test
    void appliesDefaults() {
        IoTestCase t = IoTestFiles.parse("empty", "{}");
        assertEquals(new IoTestCase("empty", "", IoTestCase.Mode.ORIGINAL, null, List.of()), t);
        assertEquals(t, IoTestFiles.parse("empty", "{\"type\":\"io\",\"expected\":null,\"ignoreLines\":null}"));
    }

    @Test
    void serializationRoundTrips() {
        IoTestCase t = new IoTestCase("a-1", "x\r\ny\n", IoTestCase.Mode.MANUAL, "ок\n", List.of(1));
        String json = IoTestFiles.toJson(t);
        assertTrue(json.indexOf("\"name\"") < json.indexOf("\"stdin\"") && json.indexOf("\"mode\"") < json.indexOf("\"ignoreLines\""));
        assertTrue(json.endsWith("\n"));
        assertEquals(t, IoTestFiles.parse("a-1", json));
        assertEquals("tests/a-1.json", IoTestFiles.pathOf("a-1"));
    }

    @Test
    void validationErrorsAreReadable() {
        assertError("некорректный JSON", "{\"stdin\": ");
        assertError("ожидался JSON-объект", "[1]");
        assertError("неизвестное поле «expect»", "{\"expect\":\"x\"}");
        assertError("не совпадает с именем файла", "{\"name\":\"other\"}");
        assertError("mode должен быть", "{\"mode\":\"auto\"}");
        assertError("требует expected", "{\"mode\":\"manual\"}");
        assertError("stdin должен быть строкой", "{\"stdin\":5}");
        assertError("type должен быть «io»", "{\"type\":\"junit\"}");
        assertError("не целое число", "{\"ignoreLines\":[\"1\"]}");
        assertError("начинаются с 1", "{\"ignoreLines\":[0]}");
        assertError("должен быть массивом", "{\"ignoreLines\":3}");
        var ex = assertThrows(IoTestFormatException.class, () -> IoTestFiles.parse("bad name", "{}"));
        assertTrue(ex.getMessage().contains("недопустимо"), ex.getMessage());
        assertThrows(IoTestFormatException.class,
                () -> IoTestFiles.toJson(new IoTestCase("../x", "", IoTestCase.Mode.ORIGINAL, null, List.of())));
    }

    private static void assertError(String fragment, String json) {
        var ex = assertThrows(IoTestFormatException.class, () -> IoTestFiles.parse("t", json), json);
        assertTrue(ex.getMessage().contains(fragment), ex.getMessage());
    }

    @Test
    void importsInOutPairs() {
        var loaded = IoTestFiles.load(Map.of(
                "src/Main.java", "class Main {}",
                "tests/basic.in", "1\n",
                "tests/basic.out", "2\r\n",
                "tests/noout.in", "5\n",
                "tests/noin.out", "hi\n",
                "tests/sub/deep.in", "x",
                "data/other.in", "x"));
        assertEquals(List.of(), loaded.errors());
        assertEquals(List.of(
                new IoTestCase("basic", "1\n", IoTestCase.Mode.MANUAL, "2\r\n", List.of()),
                new IoTestCase("noin", "", IoTestCase.Mode.MANUAL, "hi\n", List.of()),
                new IoTestCase("noout", "5\n", IoTestCase.Mode.ORIGINAL, null, List.of())), loaded.tests());
    }

    @Test
    void jsonWinsOverPairAndBadFilesAreReported() {
        var loaded = IoTestFiles.load(Map.of(
                "tests/a.json", "{\"stdin\":\"j\"}",
                "tests/a.in", "pair",
                "tests\\b.json", "{\"mode\":\"manual\",\"expected\":\"ok\"}",
                "tests/broken.json", "{oops",
                "tests/bad name.in", "x"));
        assertEquals(List.of("a", "b"), loaded.tests().stream().map(IoTestCase::name).toList());
        assertEquals("j", loaded.tests().get(0).stdin());
        assertEquals(3, loaded.errors().size(), loaded.errors().toString());
        assertTrue(loaded.errors().stream().anyMatch(e -> e.startsWith("tests/broken.json: некорректный JSON")));
        assertTrue(loaded.errors().stream().anyMatch(e -> e.startsWith("tests/a.in: ") && e.contains("уже задан")));
        assertTrue(loaded.errors().stream().anyMatch(e -> e.startsWith("tests/bad name.in: ")));
    }
}
