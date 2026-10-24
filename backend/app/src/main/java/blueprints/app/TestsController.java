package blueprints.app;

import blueprints.app.ProjectDto.TestCaseDto;
import blueprints.source.LoadedProject;
import blueprints.testing.TestContext;
import blueprints.testing.io.IoTestCase;
import blueprints.testing.io.IoTestFiles;
import blueprints.testing.io.IoTestFormatException;
import com.github.javaparser.JavaParser;
import com.github.javaparser.ParseResult;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.CompilationUnit;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Тесты проекта (§10, §12): источник правды — файлы {@code tests/} проекта. io — {@code tests/<имя>.json}
 * (или пара .in/.out, разбор {@link IoTestFiles}), junit — {@code tests/<имя>.java}. PUT/DELETE меняют version.
 */
@RestController
@RequestMapping("/api/projects/{id}/tests")
class TestsController {
    /** Тело PUT по контракту: TestCase + обязательный version (старый — 409). */
    record TestRequest(Integer version, String name, String type, String stdin, String mode, String expected,
                       List<Integer> ignoreLines, String source) {}

    record TestMutation(int version, TestCaseDto test) {}

    record Deleted(int version) {}

    /** Имя теста = имя файла в tests/: без «/», «\» и «..» (как у IoTestFiles). */
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_][A-Za-z0-9._-]*");
    private static final Pattern JAVA_NAME = Pattern.compile("[A-Za-z_$][A-Za-z0-9_$]*");
    private static final List<String> EXTS = List.of(".json", ".in", ".out", ".java");

    private final ProjectStore store;

    TestsController(ProjectStore store) {
        this.store = store;
    }

    @GetMapping
    List<TestCaseDto> list(@PathVariable String id) {
        return tests(store.get(id).content());
    }

    @GetMapping("/{name}")
    TestCaseDto get(@PathVariable String id, @PathVariable String name) {
        checkName(name);
        return find(store.get(id).content(), name);
    }

    @PutMapping("/{name}")
    TestMutation put(@PathVariable String id, @PathVariable String name, @RequestBody TestRequest req) {
        if (req.version() == null) throw new ApiException(400, "INVALID_REQUEST", "нужен version");
        checkName(name);
        if (req.name() == null || req.name().isBlank()) throw invalid("пустое имя теста");
        if (!req.name().equals(name)) throw invalid("name «" + req.name() + "» не совпадает с путём «" + name + "»");
        String path;
        String text;
        if ("io".equals(req.type())) {
            IoTestCase t;
            try {
                IoTestCase.Mode mode = IoTestCase.Mode.fromWire(req.mode() == null ? "original" : req.mode());
                t = new IoTestCase(name, req.stdin() == null ? "" : req.stdin(), mode, req.expected(), req.ignoreLines());
                text = IoTestFiles.toJson(t);
            } catch (IoTestFormatException e) {
                throw invalid(e.getMessage());
            } catch (IllegalArgumentException e) {
                throw invalid("mode должен быть «original» или «manual»");
            }
            path = IoTestFiles.pathOf(name);
        } else if ("junit".equals(req.type())) {
            if (!JAVA_NAME.matcher(name).matches()) throw invalid("имя JUnit-теста должно быть именем Java-класса: " + name);
            if (req.source() == null) throw invalid("junit: нужен source");
            ParseResult<CompilationUnit> r = new JavaParser(new ParserConfiguration()
                    .setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21)).parse(req.source());
            if (!r.isSuccessful()) {
                var problem = r.getProblems().isEmpty() ? null : r.getProblems().get(0);
                Integer at = problem == null ? null : problem.getLocation()
                        .flatMap(t -> t.getBegin().getRange()).map(x -> x.begin.line).orElse(null);
                throw ApiException.parseError(problem == null ? "ошибка разбора" : problem.getMessage(), null, at);
            }
            path = TestContext.TESTS_DIR + name + ".java";
            text = req.source();
        } else {
            throw invalid("type: io или junit");
        }
        var s = store.update(id, req.version(), p -> {
            Map<String, byte[]> files = withoutTest(p, name);
            files.put(path, text.getBytes(StandardCharsets.UTF_8));
            return withTests(p, files);
        });
        return new TestMutation(s.version(), find(s.content(), name));
    }

    @DeleteMapping("/{name}")
    Deleted delete(@PathVariable String id, @PathVariable String name, @RequestParam int version) {
        checkName(name);
        var s = store.update(id, version, p -> {
            Map<String, byte[]> files = withoutTest(p, name);
            if (files.size() == p.testFiles().size()) throw notFound(name);
            return withTests(p, files);
        });
        return new Deleted(s.version());
    }

    /**
     * Все тесты проекта (по имени, затем io раньше junit): io — как их прогоняет IoTestSource, junit — {@code tests/*.java}.
     * {@code X.json} и {@code X.java} одновременно (только после загрузки: PUT убирает файлы другого вида) — в списке оба,
     * GET /tests/X — 422 с просьбой удалить один, DELETE X — удаляет оба.
     */
    static List<TestCaseDto> tests(LoadedProject p) {
        Map<String, String> texts = new TreeMap<>();
        p.testFiles().forEach((k, v) -> texts.put(k, new String(v, StandardCharsets.UTF_8)));
        Map<String, TestCaseDto> out = new TreeMap<>(); // ключ «имя тип»: пробел меньше любого символа имени
        for (IoTestCase t : IoTestFiles.load(texts).tests()) {
            out.put(t.name() + " io", new TestCaseDto(t.name(), "io", t.stdin(), t.mode().wire(), t.expected(), t.ignoreLines(), null));
        }
        texts.forEach((path, text) -> {
            String file = path.substring(TestContext.TESTS_DIR.length());
            if (file.contains("/") || !file.endsWith(".java")) return;
            String name = file.substring(0, file.length() - ".java".length());
            out.put(name + " junit", new TestCaseDto(name, "junit", null, null, null, null, text));
        });
        return new ArrayList<>(out.values());
    }

    private static TestCaseDto find(LoadedProject p, String name) {
        List<TestCaseDto> found = tests(p).stream().filter(t -> t.name().equals(name)).toList();
        if (found.isEmpty()) throw notFound(name);
        if (found.size() > 1) {
            throw invalid("тест «" + name + "» задан и как io (tests/" + name + ".json), и как junit (tests/" + name
                    + ".java) — удалите или перезапишите (PUT) один");
        }
        return found.get(0);
    }

    private static Map<String, byte[]> withoutTest(LoadedProject p, String name) {
        Map<String, byte[]> files = new LinkedHashMap<>(p.testFiles());
        for (String ext : EXTS) files.remove(TestContext.TESTS_DIR + name + ext);
        return files;
    }

    private static LoadedProject withTests(LoadedProject p, Map<String, byte[]> tests) {
        return new LoadedProject(p.root(), p.files(), p.warnings(), tests, p.mainClasses());
    }

    private static void checkName(String name) {
        if (!NAME.matcher(name).matches() || name.contains("..")) {
            throw invalid("имя теста «" + name + "» недопустимо: только латиница, цифры, «.», «_», «-», без «..»");
        }
    }

    private static ApiException invalid(String message) {
        return new ApiException(422, "INVALID_REQUEST", message);
    }

    private static ApiException notFound(String name) {
        return new ApiException(404, "NOT_FOUND", "тест не найден: " + name);
    }
}
