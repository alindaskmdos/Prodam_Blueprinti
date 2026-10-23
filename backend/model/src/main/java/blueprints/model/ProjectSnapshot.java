package blueprints.model;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Версия проекта: путь файла -> текст (порядок сохранён) и тесты. */
public record ProjectSnapshot(String id, int version, Map<String, String> files, List<TestCase> tests) {

    public ProjectSnapshot {
        files = Collections.unmodifiableMap(new LinkedHashMap<>(files));
        tests = tests == null ? List.of() : List.copyOf(tests);
    }
}
