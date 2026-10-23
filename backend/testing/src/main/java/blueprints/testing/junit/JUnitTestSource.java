package blueprints.testing.junit;

import blueprints.runner.Runner;
import blueprints.testing.Batch;
import blueprints.testing.TestContext;
import blueprints.testing.TestResult;
import blueprints.testing.TestSource;
import blueprints.testing.TestStatus;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * JUnit 5 тесты проекта (§10.2): {@code tests/*.java} текущей версии компилируются вместе с кодом программы (пакет —
 * из объявления {@code package} теста) с переписыванием {@link Runner.Rewrite#JUNIT} только в копии
 * ({@code private} → package-private, seed), запускаются {@code junit-platform-console-standalone} в песочнице,
 * результат читается из XML-отчёта ({@link JUnitReport}). Режима «как у оригинала» нет — ожидания задают ассерты.
 * <p>
 * Запуск — один command-{@link Runner.Job} пакетного {@link Runner#runBatch}: {@link #plan} отдаёт программу, запуск и
 * монтируемый jar, {@link #results} — разбор результата. Так BE-10 кладёт JUnit в тот же контейнер, что и IO-тесты.
 * <ul>
 *   <li>не компилируются тесты или код программы → {@code compile_error} у каждого тестового класса, текст ошибок;</li>
 *   <li>таймаут ({@code Config.commandTimeout()}, 30 с на весь запуск JUnit) → {@code failed}/{@code timeout}; прогон прерван или нет отчёта →
 *       {@code failed} с причиной.</li>
 * </ul>
 */
public final class JUnitTestSource implements TestSource {

    public static final String TYPE = "junit";
    public static final String TIMEOUT = "timeout";
    public static final String TESTS_BROKEN = "тесты не компилируются";
    public static final String PROGRAM_BROKEN = "код программы не компилируется";
    /** Где jar launcher'а в контейнере (read-only). */
    public static final String LAUNCHER = "/opt/junit/junit-platform-console-standalone.jar";
    static final String REPORTS = "/tmp/bp-junit";
    static final String REPORT = REPORTS + "/TEST-junit-jupiter.xml";
    /** stdout запуска — только XML-отчёт; вывод launcher'а и тестов — в лог, он уходит в stderr, если отчёта нет. */
    static final String SCRIPT = "java \"$@\" >/tmp/bp-junit.log 2>&1; s=$?; "
            + "if [ -f " + REPORT + " ]; then cat " + REPORT + "; else cat /tmp/bp-junit.log >&2; fi; exit $s";
    private static final Pattern PACKAGE = Pattern.compile("(?m)^\\s*package\\s+([\\w.]+)\\s*;");
    private static final Pattern CLASS_NAME = Pattern.compile("[\\w$]+");
    private static final int MAX_LOG = 2000;

    /** Пакетный запуск с доп. файлами: по умолчанию {@link Runner#runBatch(List, List, Runner.Rewrite, Map)}. */
    @FunctionalInterface
    public interface BatchRunner {
        List<Runner.RunResult> runBatch(List<Runner.Program> programs, List<Runner.Job> jobs, Map<String, Path> files);
    }

    /** Тестовый файл: путь в проекте и полное имя класса. */
    public record TestFile(String path, String className) {}

    /**
     * Что положить в пакет: программа (код + тесты), её запуск и файлы для монтирования ({@code files} в runBatch).
     */
    public record Plan(List<TestFile> tests, Runner.Program program, Runner.Job job, Map<String, Path> files) {}

    private final BatchRunner runner;
    private final Supplier<Path> launcher;

    public JUnitTestSource(Runner runner) {
        this((programs, jobs, files) -> runner.runBatch(programs, jobs, Runner.Rewrite.RUN, files), LauncherJar::path);
    }

    public JUnitTestSource(BatchRunner runner, Supplier<Path> launcher) {
        this.runner = runner;
        this.launcher = launcher;
    }

    @Override
    public String id() {
        return TYPE;
    }

    @Override
    public List<TestResult> run(TestContext ctx) {
        Batch batch = new Batch();
        Prepared p = prepare(ctx, batch);
        if (batch.jobs().isEmpty()) return List.of();
        return p.results(runner.runBatch(batch.programs(), batch.jobs(), batch.files()));
    }

    /** Для общего пакета: программа (код + тесты) и command-запуск {@link #plan} добавляются в {@code batch}. */
    @Override
    public Prepared prepare(TestContext ctx, Batch batch) {
        Optional<Plan> plan = plan(ctx, batch.nextProgram());
        if (plan.isEmpty()) return rs -> List.of();
        Plan p = plan.get();
        batch.addProgram(p.program());
        int job = batch.addJob(p.job());
        p.files().forEach(batch::addFile);
        return rs -> results(p, rs.get(job));
    }

    /** Тестовые файлы: все {@code .java} в {@code tests/}, по порядку путей. */
    public static List<TestFile> testFiles(Map<String, String> files) {
        List<TestFile> res = new ArrayList<>();
        files.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(e -> {
            String path = e.getKey().replace('\\', '/');
            if (!path.startsWith(TestContext.TESTS_DIR) || !path.endsWith(".java")) return;
            String name = path.substring(path.lastIndexOf('/') + 1).replaceAll("\\.java$", "");
            if (!CLASS_NAME.matcher(name).matches()) return;
            Matcher p = PACKAGE.matcher(e.getValue());
            res.add(new TestFile(path, p.find() ? p.group(1) + "." + name : name));
        });
        return res;
    }

    /**
     * План запуска JUnit текущей версии как программы с индексом {@code programIndex} в пакете.
     * Пусто — тестов нет. Исходники из ctx не меняются: переписывание делает Runner в копии.
     */
    public Optional<Plan> plan(TestContext ctx, int programIndex) {
        List<TestFile> tests = testFiles(ctx.currentFiles());
        if (tests.isEmpty()) return Optional.empty();
        Map<String, String> sources = new LinkedHashMap<>(TestContext.javaSources(ctx.currentFiles()));
        for (TestFile t : tests) {
            String text = ctx.currentFiles().get(t.path());
            if (text == null) text = ctx.currentFiles().get(t.path().replace('/', '\\'));
            sources.put(t.path(), text);
        }
        Path jar = launcher.get();
        Runner.Program program = new Runner.Program(sources, null, Runner.Rewrite.JUNIT, List.of(jar));
        List<String> cmd = new ArrayList<>(List.of("sh", "-c", SCRIPT, "sh",
                "-jar", LAUNCHER, "execute", "--disable-banner", "--disable-ansi-colors", "--details=none",
                "--class-path", Runner.programDir(programIndex), "--reports-dir", REPORTS));
        for (TestFile t : tests) cmd.addAll(List.of("--select-class", t.className()));
        return Optional.of(new Plan(tests, program, new Runner.Job(programIndex, "", cmd), Map.of(LAUNCHER, jar)));
    }

    /** Результаты по запуску из {@link #plan}: по тесту из отчёта, при сбое — по одному на тестовый класс. */
    public List<TestResult> results(Plan plan, Runner.RunResult r) {
        if (!r.compiled()) {
            return perClass(plan, TestStatus.COMPILE_ERROR, compileError(plan, r.diagnostics()));
        }
        if (r.aborted()) return perClass(plan, TestStatus.FAILED, r.stderr());
        if (r.timedOut()) return perClass(plan, TestStatus.FAILED, TIMEOUT);
        List<TestResult> res;
        try {
            res = JUnitReport.parse(r.stdout());
        } catch (IllegalArgumentException e) {
            return perClass(plan, TestStatus.FAILED, "нет отчёта JUnit (exit " + r.exitCode() + ")" + log(r));
        }
        // отчёт без тестов при ненулевом выходе — launcher упал до запуска тестов
        if (res.isEmpty() && r.exitCode() != 0) {
            return perClass(plan, TestStatus.FAILED, "JUnit завершился с кодом " + r.exitCode() + log(r));
        }
        return res;
    }

    private static String log(Runner.RunResult r) {
        String err = r.stderr().strip();
        if (err.isEmpty()) return "";
        return ": " + (err.length() > MAX_LOG ? err.substring(err.length() - MAX_LOG) : err);
    }

    /** Ошибка в файле теста → «тесты не компилируются», иначе — код программы (в т.ч. после private→package-private). */
    private static String compileError(Plan plan, List<String> diagnostics) {
        boolean inTests = diagnostics.stream().anyMatch(d -> plan.tests().stream()
                .anyMatch(t -> d.startsWith(t.path().substring(t.path().lastIndexOf('/') + 1) + ":")));
        return (inTests ? TESTS_BROKEN : PROGRAM_BROKEN) + ":\n" + JUnitReport.cut(String.join("\n", diagnostics));
    }

    private static List<TestResult> perClass(Plan plan, TestStatus status, String error) {
        return plan.tests().stream()
                .map(t -> new TestResult(t.className(), TYPE, status, 0, error, null, null, List.of()))
                .toList();
    }
}
