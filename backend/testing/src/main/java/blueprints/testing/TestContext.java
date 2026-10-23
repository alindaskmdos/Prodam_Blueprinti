package blueprints.testing;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Вход прогона тестов: все файлы проекта (путь как в загруженном проекте → текст).
 *
 * @param originalFiles файлы исходной (загруженной) версии — эталон для {@code mode: original}
 * @param currentFiles  файлы текущей версии; тесты ({@code tests/...}) берутся отсюда
 * @param mainClass     полное имя main-класса; null — единственный main
 */
public record TestContext(Map<String, String> originalFiles, Map<String, String> currentFiles, String mainClass) {

    public static final String TESTS_DIR = "tests/";

    public TestContext {
        originalFiles = Map.copyOf(originalFiles);
        currentFiles = Map.copyOf(currentFiles);
    }

    /** Исходники программы: все {@code .java}, кроме лежащих в {@code tests/} (там JUnit-тесты). */
    public static Map<String, String> javaSources(Map<String, String> files) {
        Map<String, String> res = new LinkedHashMap<>();
        files.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(e -> {
            String path = e.getKey().replace('\\', '/');
            if (path.endsWith(".java") && !path.startsWith(TESTS_DIR)) res.put(path, e.getValue());
        });
        return res;
    }
}
