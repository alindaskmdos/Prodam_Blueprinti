package blueprints.testing.io;

import blueprints.testing.TestContext;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Файлы IO-тестов проекта: {@code tests/<имя>.json} (§10.1) и пары {@code tests/<имя>.in} / {@code .out}.
 * Разбор, валидация, обратная сериализация. Без состояния.
 */
public final class IoTestFiles {

    /** Результат разбора проекта: корректные тесты по имени и ошибки по файлам (файл пропускается, код не теряется). */
    public record Loaded(List<IoTestCase> tests, List<String> errors) {
        public Loaded {
            tests = List.copyOf(tests);
            errors = List.copyOf(errors);
        }
    }

    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_][A-Za-z0-9._-]*");
    private static final Pattern TEST_FILE = Pattern.compile("tests/([^/]+)\\.(json|in|out)");
    private static final Set<String> FIELDS = Set.of("name", "type", "stdin", "mode", "expected", "ignoreLines");
    private static final ObjectMapper JSON = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

    private IoTestFiles() {}

    /** Путь json-файла теста в проекте. */
    public static String pathOf(String name) {
        return TestContext.TESTS_DIR + name + ".json";
    }

    /**
     * Все IO-тесты проекта: {@code tests/*.json}, а также пары {@code .in}/{@code .out}: stdin = .in,
     * mode manual, expected = .out; без .out — mode original; .out без .in — пустой stdin.
     * При совпадении имён json важнее, пара пропускается с ошибкой. Вложенные папки в tests/ не смотрятся.
     */
    public static Loaded load(Map<String, String> files) {
        Map<String, String> json = new TreeMap<>();
        Map<String, String> in = new TreeMap<>();
        Map<String, String> out = new TreeMap<>();
        for (var e : files.entrySet()) {
            Matcher m = TEST_FILE.matcher(e.getKey().replace('\\', '/'));
            if (!m.matches()) continue;
            (switch (m.group(2)) {
                case "json" -> json;
                case "in" -> in;
                default -> out;
            }).put(m.group(1), e.getValue());
        }
        Map<String, IoTestCase> tests = new TreeMap<>();
        List<String> errors = new ArrayList<>();
        for (var e : json.entrySet()) {
            try {
                tests.put(e.getKey(), parse(e.getKey(), e.getValue()));
            } catch (IoTestFormatException ex) {
                errors.add(pathOf(e.getKey()) + ": " + ex.getMessage());
            }
        }
        Set<String> pairNames = new java.util.TreeSet<>(in.keySet());
        pairNames.addAll(out.keySet());
        for (String name : pairNames) {
            String where = TestContext.TESTS_DIR + name + (in.containsKey(name) ? ".in" : ".out");
            if (json.containsKey(name)) {
                errors.add(where + ": тест с именем «" + name + "» уже задан в " + pathOf(name) + ", пара .in/.out пропущена");
                continue;
            }
            String expected = out.get(name);
            IoTestCase t = new IoTestCase(name, in.getOrDefault(name, ""),
                    expected == null ? IoTestCase.Mode.ORIGINAL : IoTestCase.Mode.MANUAL, expected, List.of());
            try {
                validate(t);
                tests.put(name, t);
            } catch (IoTestFormatException ex) {
                errors.add(where + ": " + ex.getMessage());
            }
        }
        return new Loaded(new ArrayList<>(tests.values()), errors);
    }

    /**
     * Разбор {@code tests/<fileName>.json}. Поле {@code name} необязательно, но если задано — должно совпадать
     * с именем файла. Неизвестные поля — ошибка (ловит опечатки).
     *
     * @param fileName имя файла без {@code .json}
     */
    public static IoTestCase parse(String fileName, String text) {
        JsonNode root;
        try {
            root = JSON.readTree(text);
        } catch (JsonProcessingException e) {
            throw new IoTestFormatException("некорректный JSON: " + e.getOriginalMessage()
                    + (e.getLocation() != null ? " (строка " + e.getLocation().getLineNr() + ")" : ""));
        }
        if (root == null || !root.isObject()) throw new IoTestFormatException("ожидался JSON-объект");
        for (Iterator<String> it = root.fieldNames(); it.hasNext(); ) {
            String f = it.next();
            if (!FIELDS.contains(f)) throw new IoTestFormatException("неизвестное поле «" + f + "», допустимы: " + FIELDS);
        }
        String name = optString(root, "name", fileName);
        if (!name.equals(fileName)) {
            throw new IoTestFormatException("name «" + name + "» не совпадает с именем файла «" + fileName + "»");
        }
        String type = optString(root, "type", IoTestCase.TYPE);
        if (!IoTestCase.TYPE.equals(type)) throw new IoTestFormatException("type должен быть «io», а не «" + type + "»");
        String stdin = optString(root, "stdin", "");
        String modeText = optString(root, "mode", IoTestCase.Mode.ORIGINAL.wire());
        IoTestCase.Mode mode;
        try {
            mode = IoTestCase.Mode.fromWire(modeText);
        } catch (IllegalArgumentException e) {
            throw new IoTestFormatException("mode должен быть «original» или «manual», а не «" + modeText + "»");
        }
        String expected = optString(root, "expected", null);
        List<Integer> ignore = new ArrayList<>();
        JsonNode il = root.get("ignoreLines");
        if (il != null && !il.isNull()) {
            if (!il.isArray()) throw new IoTestFormatException("ignoreLines должен быть массивом номеров строк");
            for (JsonNode n : il) {
                if (!n.isIntegralNumber() || !n.canConvertToInt()) {
                    throw new IoTestFormatException("ignoreLines: «" + n + "» — не целое число");
                }
                ignore.add(n.intValue());
            }
        }
        IoTestCase t = new IoTestCase(name, stdin, mode, expected, ignore);
        validate(t);
        return t;
    }

    /** Проверка инвариантов теста; бросает {@link IoTestFormatException} с понятным текстом. */
    public static void validate(IoTestCase t) {
        if (t.name() == null || t.name().isBlank()) throw new IoTestFormatException("пустое имя теста");
        if (!NAME.matcher(t.name()).matches()) {
            throw new IoTestFormatException("имя «" + t.name() + "» недопустимо: только латиница, цифры, «.», «_», «-», без «/»");
        }
        if (t.stdin() == null) throw new IoTestFormatException("stdin не задан");
        if (t.mode() == null) throw new IoTestFormatException("mode не задан");
        if (t.mode() == IoTestCase.Mode.MANUAL && t.expected() == null) {
            throw new IoTestFormatException("mode manual требует expected (ожидаемый вывод)");
        }
        for (Integer n : t.ignoreLines()) {
            if (n == null || n < 1) throw new IoTestFormatException("ignoreLines: номера строк начинаются с 1, получено " + n);
        }
    }

    /** Обратная сериализация в формат §10.1 (порядок полей фиксирован, перевод строки в конце). */
    public static String toJson(IoTestCase t) {
        validate(t);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", t.name());
        m.put("stdin", t.stdin());
        m.put("mode", t.mode().wire());
        m.put("expected", t.expected());
        m.put("ignoreLines", t.ignoreLines());
        try {
            return JSON.writeValueAsString(m) + "\n";
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String optString(JsonNode root, String field, String def) {
        JsonNode n = root.get(field);
        if (n == null || n.isNull()) return def;
        if (!n.isTextual()) throw new IoTestFormatException(field + " должен быть строкой");
        return n.textValue();
    }
}
