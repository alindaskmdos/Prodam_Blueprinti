package blueprints.testing.io;

import blueprints.runner.Runner;
import blueprints.testing.Batch;
import blueprints.testing.Noise;
import blueprints.testing.TestContext;
import blueprints.testing.TestResult;
import blueprints.testing.TestSource;
import blueprints.testing.TestStatus;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

/**
 * IO-тесты (§10.1). Весь прогон — один пакет {@link Runner#runBatch} (один контейнер): программа 0 — текущая версия,
 * программа 1 — оригинал; каждый тест запускается на обеих. В общем пакете проверки поведения ({@link #prepare})
 * оригинал запускается дважды, различающиеся строки — шумные (§10.4): не сравниваются, номера — в noisyLines.
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

    /** Прогон заданного списка тестов (тесты уже разобраны): оригинал — один раз, шум не определяется. */
    public List<TestResult> run(List<IoTestCase> tests, TestContext ctx) {
        if (tests.isEmpty()) return List.of();
        Batch batch = new Batch();
        Prepared p = prepare(tests, ctx, batch, 1);
        return p.results(runner.runBatch(batch.programs(), batch.jobs()));
    }

    /** Для общего пакета проверки поведения: оригинал гоняется <b>дважды</b> (§10.4), шумные строки → noisyLines. */
    @Override
    public Prepared prepare(TestContext ctx, Batch batch) {
        return prepare(IoTestFiles.load(ctx.currentFiles()).tests(), ctx, batch, 2);
    }

    /** Есть IO-тест с непустым stdin. */
    @Override
    public boolean providesInput(TestContext ctx) {
        return IoTestFiles.load(ctx.currentFiles()).tests().stream().anyMatch(t -> !t.stdin().isEmpty());
    }

    /**
     * Добавляет в пакет текущую версию и оригинал; запуски — все тесты на текущей, затем {@code originalRuns} раз
     * все тесты на оригинале. Программы — без своего rewrite: действует rewrite пакета ({@code Rewrite.RUN}).
     */
    Prepared prepare(List<IoTestCase> tests, TestContext ctx, Batch batch, int originalRuns) {
        if (tests.isEmpty()) return rs -> List.of();
        int cur = batch.addProgram(new Runner.Program(TestContext.javaSources(ctx.currentFiles()), ctx.mainClass()));
        int orig = batch.addProgram(new Runner.Program(TestContext.javaSources(ctx.originalFiles()), ctx.mainClass()));
        int first = batch.jobs().size();
        for (IoTestCase t : tests) batch.addJob(new Runner.Job(cur, t.stdin()));
        for (int k = 0; k < originalRuns; k++) {
            for (IoTestCase t : tests) batch.addJob(new Runner.Job(orig, t.stdin()));
        }
        int n = tests.size();
        return rs -> {
            List<TestResult> results = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                Runner.RunResult second = originalRuns > 1 ? rs.get(first + 2 * n + i) : null;
                results.add(judge(tests.get(i), rs.get(first + i), rs.get(first + n + i), second));
            }
            return results;
        };
    }

    /**
     * Шумные строки: различия первого и второго прогона оригинала. Пусто, если второго прогона нет или
     * хоть один прогон не годится в эталон (не скомпилирован, завис, прерван, вывод обрезан).
     */
    static List<Integer> noisyLines(Runner.RunResult orig, Runner.RunResult second) {
        if (second == null || originalProblem(orig) != null || originalProblem(second) != null
                || orig.truncated() || second.truncated()) {
            return List.of();
        }
        return Noise.noisyLines(orig.stdout(), second.stdout());
    }

    /**
     * Вердикт по одному тесту: {@code cur} и {@code orig} — запуски текущей версии и оригинала на его stdin,
     * {@code second} — второй прогон оригинала или null. Шумные строки не сравниваются (вместе с ignoreLines)
     * в обоих режимах и попадают в noisyLines.
     */
    private TestResult judge(IoTestCase t, Runner.RunResult cur, Runner.RunResult orig, Runner.RunResult second) {
        List<Integer> noisy = noisyLines(orig, second);
        if (!cur.compiled()) {
            return result(t, TestStatus.COMPILE_ERROR, 0, String.join("\n", cur.diagnostics()), null, null, noisy);
        }
        if (cur.aborted()) return result(t, TestStatus.FAILED, 0, cur.stderr(), null, null, noisy);
        Set<Integer> ignored = new TreeSet<>(t.ignoreLines());
        ignored.addAll(noisy);
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
            return result(t, status, cur.millis(), error, t.expected(), cur.stdout(), noisy);
        }
        if (origProblem != null) {
            TestStatus s = orig.aborted() ? TestStatus.FAILED : TestStatus.ORIGINAL_FAILS;
            return result(t, s, cur.millis(), origProblem + " — эталон не получен", null, cur.stdout(), noisy);
        }
        if (cur.timedOut()) return result(t, TestStatus.FAILED, cur.millis(), TIMEOUT, orig.stdout(), cur.stdout(), noisy);
        if (unstableExit(orig, second)) {
            // оригинал сам завершается по-разному: код выхода и исключение эталоном быть не могут — сравнивается
            // только stdout (без шумных строк); совпал → passed с пометкой, вердикт verify — incomplete
            Observed ref = new Observed(orig.stdout(), null, null, orig.truncated());
            OutputComparator.Comparison c = comparator.compare(ref, Observed.of(cur), ignored);
            return result(t, c.matches() ? TestStatus.PASSED : TestStatus.FAILED, cur.millis(),
                    c.matches() ? TestResult.UNSTABLE_ORIGINAL : c.error() + "; " + TestResult.UNSTABLE_ORIGINAL,
                    orig.stdout(), cur.stdout(), noisy);
        }
        OutputComparator.Comparison c = comparator.compare(Observed.of(orig), Observed.of(cur), ignored);
        return result(t, c.matches() ? TestStatus.PASSED : TestStatus.FAILED, cur.millis(), c.error(),
                orig.stdout(), cur.stdout(), noisy);
    }

    /** Два пригодных прогона оригинала дали разный код выхода или разное необработанное исключение. */
    static boolean unstableExit(Runner.RunResult orig, Runner.RunResult second) {
        if (second == null || originalProblem(second) != null) return false;
        Observed a = Observed.of(orig);
        Observed b = Observed.of(second);
        return !Objects.equals(a.exitCode(), b.exitCode()) || !Objects.equals(a.exception(), b.exception());
    }

    /** Почему запуск оригинала непригоден как эталон; null — пригоден. */
    private static String originalProblem(Runner.RunResult orig) {
        if (!orig.compiled()) return "оригинал не компилируется";
        if (orig.aborted()) return "оригинал не запущен: " + orig.stderr();
        if (orig.timedOut()) return "оригинал завис по таймауту";
        return null;
    }

    private static TestResult result(IoTestCase t, TestStatus s, long ms, String error, String expected, String actual,
                                     List<Integer> noisy) {
        return new TestResult(t.name(), IoTestCase.TYPE, s, ms, error, expected, actual, noisy);
    }
}
