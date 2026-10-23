package blueprints.testing.io;

import blueprints.runner.Runner;
import blueprints.testing.TestContext;
import blueprints.testing.TestResult;
import blueprints.testing.TestSource;
import blueprints.testing.TestStatus;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * IO-тесты (§10.1). Весь прогон — один пакет {@link Runner#runBatch} (один контейнер): программа 0 — текущая версия,
 * программа 1 — оригинал; каждый тест запускается на обеих.
 * <ul>
 *   <li>{@code original}: эталон — stdout, exit code и исключение оригинала; оригинал не скомпилировался или
 *       завис → {@code original_fails} (эталона нет).</li>
 *   <li>{@code manual}: эталон — только {@code expected}. Текущая не прошла: оригинал тоже не прошёл →
 *       {@code original_fails}, оригинал прошёл → {@code failed}. Текущая прошла, а оригинал нет → {@code passed} с
 *       пояснением в error. Оригинал не скомпилировался/завис — отдельный текст в error, не «тоже не проходит».</li>
 *   <li>текущая версия не компилируется → {@code compile_error}; таймаут → {@code failed}, error = «timeout»;
 *       прогон прерван (песочница не отвечала) → {@code failed} с причиной.</li>
 * </ul>
 * Некорректные файлы тестов здесь пропускаются: их ошибки отдаёт {@link IoTestFiles#load}.
 */
public final class IoTestSource implements TestSource {

    public static final String TIMEOUT = "timeout";
    public static final String ORIGINAL_ALSO_FAILS = "оригинал тоже не проходит этот тест";
    public static final String FIXED_BY_EDIT = "оригинал не проходит этот тест — правка его исправила";
    static final int CURRENT = 0;
    static final int ORIGINAL = 1;

    /** Пакетный запуск: по умолчанию {@link Runner#runBatch} (один контейнер на пакет); подменяется в тестах. */
    @FunctionalInterface
    public interface BatchRunner {
        List<Runner.RunResult> runBatch(List<Runner.Program> programs, List<Runner.Job> jobs);
    }

    private final BatchRunner runner;
    private final OutputComparator comparator;

    public IoTestSource(Runner runner) {
        this((programs, jobs) -> runner.runBatch(programs, jobs, Runner.Rewrite.RUN), new OutputComparator());
    }

    public IoTestSource(BatchRunner runner, OutputComparator comparator) {
        this.runner = runner;
        this.comparator = comparator;
    }

    @Override
    public String id() {
        return IoTestCase.TYPE;
    }

    @Override
    public List<TestResult> run(TestContext ctx) {
        return run(IoTestFiles.load(ctx.currentFiles()).tests(), ctx);
    }

    /** Прогон заданного списка тестов (тесты уже разобраны). */
    public List<TestResult> run(List<IoTestCase> tests, TestContext ctx) {
        if (tests.isEmpty()) return List.of();
        List<Runner.Program> programs = List.of(
                new Runner.Program(TestContext.javaSources(ctx.currentFiles()), ctx.mainClass()),
                new Runner.Program(TestContext.javaSources(ctx.originalFiles()), ctx.mainClass()));
        List<Runner.Job> jobs = new ArrayList<>();
        for (IoTestCase t : tests) jobs.add(new Runner.Job(CURRENT, t.stdin()));
        for (IoTestCase t : tests) jobs.add(new Runner.Job(ORIGINAL, t.stdin()));
        List<Runner.RunResult> rs = runner.runBatch(programs, jobs);
        List<TestResult> results = new ArrayList<>();
        for (int i = 0; i < tests.size(); i++) {
            results.add(judge(tests.get(i), rs.get(i), rs.get(tests.size() + i)));
        }
        return results;
    }

    /** Вердикт по одному тесту: {@code cur} и {@code orig} — запуски текущей версии и оригинала на его stdin. */
    private TestResult judge(IoTestCase t, Runner.RunResult cur, Runner.RunResult orig) {
        if (!cur.compiled()) {
            return result(t, TestStatus.COMPILE_ERROR, 0, String.join("\n", cur.diagnostics()), null, null);
        }
        if (cur.aborted()) return result(t, TestStatus.FAILED, 0, cur.stderr(), null, null);
        Set<Integer> ignored = new HashSet<>(t.ignoreLines());
        String origProblem = originalProblem(orig);
        if (t.mode() == IoTestCase.Mode.MANUAL) {
            Observed expected = Observed.stdoutOnly(t.expected());
            OutputComparator.Comparison c = cur.timedOut() ? new OutputComparator.Comparison(false, TIMEOUT)
                    : comparator.compare(expected, Observed.of(cur), ignored);
            boolean origPasses = origProblem == null && comparator.compare(expected, Observed.of(orig), ignored).matches();
            TestStatus status;
            String error;
            if (c.matches()) {
                status = TestStatus.PASSED;
                error = origProblem != null ? origProblem : origPasses ? null : FIXED_BY_EDIT;
            } else if (origProblem != null) {
                status = TestStatus.FAILED;
                error = c.error() + "; " + origProblem + " — проверить тест на оригинале нельзя";
            } else if (!origPasses) {
                status = TestStatus.ORIGINAL_FAILS;
                error = ORIGINAL_ALSO_FAILS + "; " + c.error();
            } else {
                status = TestStatus.FAILED;
                error = c.error();
            }
            return result(t, status, cur.millis(), error, t.expected(), cur.stdout());
        }
        if (origProblem != null) {
            TestStatus s = orig.aborted() ? TestStatus.FAILED : TestStatus.ORIGINAL_FAILS;
            return result(t, s, cur.millis(), origProblem + " — эталон не получен", null, cur.stdout());
        }
        if (cur.timedOut()) return result(t, TestStatus.FAILED, cur.millis(), TIMEOUT, orig.stdout(), cur.stdout());
        OutputComparator.Comparison c = comparator.compare(Observed.of(orig), Observed.of(cur), ignored);
        return result(t, c.matches() ? TestStatus.PASSED : TestStatus.FAILED, cur.millis(), c.error(),
                orig.stdout(), cur.stdout());
    }

    /** Почему запуск оригинала непригоден как эталон; null — пригоден. */
    private static String originalProblem(Runner.RunResult orig) {
        if (!orig.compiled()) return "оригинал не компилируется";
        if (orig.aborted()) return "оригинал не запущен: " + orig.stderr();
        if (orig.timedOut()) return "оригинал завис по таймауту";
        return null;
    }

    private static TestResult result(IoTestCase t, TestStatus s, long ms, String error, String expected, String actual) {
        return new TestResult(t.name(), IoTestCase.TYPE, s, ms, error, expected, actual, List.of());
    }
}
