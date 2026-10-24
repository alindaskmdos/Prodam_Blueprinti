package blueprints.app;

import blueprints.app.ProjectDto.TestCaseDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Импорт tests/: *.json (ТЗ §10.1), пары *.in/*.out (mode=manual, expected = .out — как IoTestFiles), *.java (JUnit). Только прямые дети tests/. */
final class TestImporter {
    private static final ObjectMapper JSON = new ObjectMapper();

    private TestImporter() {}

    static List<TestCaseDto> tests(Map<String, byte[]> files) {
        Map<String, byte[]> sorted = new TreeMap<>(files); // детерминированный порядок
        List<TestCaseDto> out = new ArrayList<>();
        for (var e : sorted.entrySet()) {
            String file = e.getKey().substring("tests/".length());
            if (file.contains("/")) continue;
            String text = new String(e.getValue(), StandardCharsets.UTF_8);
            if (file.endsWith(".json")) {
                try {
                    out.add(json(file.substring(0, file.length() - 5), JSON.readTree(text)));
                } catch (Exception ex) {
                    // битый json не тест; сами байты остаются в проекте и уйдут в экспорт
                }
            } else if (file.endsWith(".in") && sorted.containsKey("tests/" + file.substring(0, file.length() - 3) + ".out")) {
                String expected = new String(sorted.get("tests/" + file.substring(0, file.length() - 3) + ".out"), StandardCharsets.UTF_8);
                out.add(new TestCaseDto(file.substring(0, file.length() - 3), "io", text, "manual", expected, List.of(), null));
            } else if (file.endsWith(".java")) {
                out.add(new TestCaseDto(file.substring(0, file.length() - 5), "junit", null, null, null, null, text));
            }
        }
        return out;
    }

    private static TestCaseDto json(String fileName, JsonNode n) {
        List<Integer> ignore = new ArrayList<>();
        n.path("ignoreLines").forEach(x -> ignore.add(x.asInt()));
        return new TestCaseDto(n.path("name").asText(fileName), "io", n.path("stdin").asText(""),
                n.path("mode").asText("original"), n.hasNonNull("expected") ? n.get("expected").asText() : null, ignore, null);
    }
}
