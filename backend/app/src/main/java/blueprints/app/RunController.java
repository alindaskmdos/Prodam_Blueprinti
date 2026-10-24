package blueprints.app;

import blueprints.runner.Runner;
import blueprints.source.LoadedProject;
import blueprints.testing.BehaviorVerifier;
import blueprints.testing.TestContext;
import blueprints.testing.TestResult;
import blueprints.testing.TestSourceRegistry;
import blueprints.testing.VerifyResult;
import blueprints.testing.io.IoTestFiles;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Запуск программы и проверка поведения (§10, §11а, §12): склейка {@link Runner} и {@link BehaviorVerifier}. */
@RestController
@RequestMapping("/api/projects/{id}")
class RunController {
    record RunRequest(String mainClass, String stdin) {}

    record CompileError(String file, int line, String message) {}

    record RunDto(String stdout, String stderr, int exitCode, boolean timedOut, int durationMs, List<CompileError> compileErrors) {}

    record TestResultDto(String name, String type, String status, int durationMs, String error, String expected,
                         String actual, List<Integer> noisyLines) {}

    record VerifyDto(String status, List<TestResultDto> results, List<String> warnings) {}

    /** Диагностика javac из Runner: «Файл.java:строка: сообщение». */
    private static final Pattern DIAG = Pattern.compile("(?s)([^:]+\\.java):(\\d+): (.*)");

    private final ProjectStore store;
    private final Runner runner;
    private final BehaviorVerifier verifier;

    RunController(ProjectStore store) {
        this.store = store;
        this.runner = new Runner(Runner.Config.defaults());
        this.verifier = new BehaviorVerifier(TestSourceRegistry.defaults(runner), runner);
    }

    @PostMapping("/run")
    RunDto run(@PathVariable String id, @RequestBody(required = false) RunRequest req) {
        String main = req == null ? null : req.mainClass();
        String stdin = req == null || req.stdin() == null ? "" : req.stdin();
        Map<String, String> sources = TestContext.javaSources(texts(store.get(id).content()));
        List<String> mains = Runner.findMainClasses(sources);
        if (main == null) {
            ambiguous(mains);
            if (mains.isEmpty()) throw new ApiException(422, "INVALID_REQUEST", "в проекте нет метода main");
        } else if (!mains.contains(main)) {
            throw new ApiException(422, "INVALID_REQUEST", "main-класс не найден: " + main + ", есть: " + mains,
                    Map.of("mainClasses", mains));
        }
        String mainClass = main;
        Runner.RunResult r = sandbox(() -> runner.run(sources, mainClass, stdin, Runner.Rewrite.RUN));
        List<CompileError> errors = r.diagnostics().stream().map(d -> compileError(d, sources)).toList();
        return new RunDto(r.stdout(), r.stderr(), r.exitCode(), r.timedOut(), (int) r.millis(), errors);
    }

    @PostMapping("/verify")
    VerifyDto verify(@PathVariable String id) {
        var s = store.get(id);
        TestContext ctx = new TestContext(texts(s.original()), texts(s.content()), null);
        // до запуска: Runner на этих данных бросил бы IllegalArgumentException (500)
        boolean io = !IoTestFiles.load(ctx.currentFiles()).tests().isEmpty();
        for (var version : List.of(Map.entry("текущей версии", ctx.currentFiles()), Map.entry("оригинале", ctx.originalFiles()))) {
            List<String> mains = Runner.findMainClasses(TestContext.javaSources(version.getValue()));
            if (io) ambiguous(mains); // mainClass нужен только IO-тестам
            if (io && mains.isEmpty()) {
                throw new ApiException(422, "INVALID_REQUEST", "IO-тестам нужен метод main, а в " + version.getKey() + " его нет");
            }
        }
        VerifyResult v = sandbox(() -> verifier.verify(ctx));
        return new VerifyDto(v.status().wire(), v.results().stream().map(RunController::dto).toList(), v.warnings());
    }

    /** Адаптер testing.TestResult → TestResult контракта (временный тип testing, см. его README). */
    static TestResultDto dto(TestResult r) {
        return new TestResultDto(r.name(), r.type(), r.status().wire(), (int) r.durationMs(), r.error(), r.expected(),
                r.actual(), r.noisyLines());
    }

    private static void ambiguous(List<String> mains) {
        if (mains.size() > 1) {
            throw new ApiException(422, "AMBIGUOUS_MAIN", "несколько main-классов, укажите mainClass",
                    Map.of("mainClasses", mains));
        }
    }

    /**
     * Сбой запуска вне кода пользователя → 503 INTERNAL с сообщением Runner: IllegalStateException (контейнер не стартовал,
     * прерван, нет JDK) или UncheckedIOException (нет docker, ошибка временной папки). Остальное — общий обработчик (500).
     */
    private static <T> T sandbox(Supplier<T> call) {
        try {
            return call.get();
        } catch (IllegalStateException | UncheckedIOException e) {
            throw new ApiException(503, "INTERNAL", e.getMessage());
        }
    }

    /** Runner пишет только имя файла — путь берётся из проекта, если файл с таким именем один. */
    static CompileError compileError(String diag, Map<String, String> sources) {
        Matcher m = DIAG.matcher(diag);
        if (!m.matches()) return new CompileError("", 0, diag);
        List<String> paths = sources.keySet().stream()
                .filter(p -> p.equals(m.group(1)) || p.endsWith("/" + m.group(1))).toList();
        return new CompileError(paths.size() == 1 ? paths.get(0) : m.group(1), Integer.parseInt(m.group(2)), m.group(3));
    }

    /** Все файлы проекта (исходники + tests/) как текст. */
    static Map<String, String> texts(LoadedProject p) {
        Map<String, String> m = new LinkedHashMap<>();
        p.files().forEach(f -> m.put(f.path(), f.text()));
        p.testFiles().forEach((k, v) -> m.put(k, new String(v, StandardCharsets.UTF_8)));
        return m;
    }
}
