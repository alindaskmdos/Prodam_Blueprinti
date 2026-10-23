package blueprints.testing;

import blueprints.runner.Runner;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * «Проверить поведение» проекта (§10.3–10.5, POST /projects/{id}/verify): все источники из {@link TestSourceRegistry}
 * кладут свои запуски в <b>один</b> общий пакет ({@link TestSource#prepare}) — один {@link Runner#runBatch}, один
 * контейнер, переписывание {@link Runner.Rewrite#RUN} (seed) для всех программ без своего rewrite (текущая версия и
 * оригинал IO-тестов). IO-тесты гоняют оригинал дважды; различия прогонов — {@code noisyLines} (см. {@link Noise}).
 * <p>
 * Статус, по приоритету:
 * <ol>
 *   <li>{@code blocked} — программа текущей версии читает stdin ({@link StdinUsage}), а ни один источник не даёт
 *       тестов с непустым входом ({@link TestSource#providesInput}); тесты не запускаются;</li>
 *   <li>{@code red} — хоть один результат не {@code passed} ({@code failed}, {@code original_fails},
 *       {@code compile_error}): расхождение найдено на не шумных строках, оно достоверно и важнее неполноты;</li>
 *   <li>{@code incomplete} — всё прошло, но хоть в одном тесте шумных строк больше половины вывода
 *       ({@link Noise#mostlyNoise}), или оригинал завершается недетерминированно
 *       ({@link TestResult#unstableOriginal}), либо тестов нет вовсе (проверена только компиляция);</li>
 *   <li>{@code green} — все тесты всех источников {@code passed} (manual «починенный» правкой и пропущенный
 *       JUnit-тест — тоже {@code passed}, по decisions.md).</li>
 * </ol>
 * Предупреждения: шум, недетерминированное завершение оригинала (с именами тестов), «N тестов пропущено (@Disabled)»,
 * подсказка при отсутствии тестов.
 */
public final class BehaviorVerifier {

    public static final String WARN_STDIN = "программа читает System.in — добавьте тест со входными данными";
    public static final String WARN_NOISY = "программа недетерминирована, проверка неполная";
    public static final String WARN_NO_TESTS = "Тестов пока нет — проверена компиляция. Добавьте IO-тест (можно сохранить "
            + "из запуска), и каждое изменение будет подтверждаться автоматически";

    /** Пакетный запуск с монтируемыми файлами; по умолчанию {@link Runner#runBatch(List, List, Runner.Rewrite, Map)}. */
    @FunctionalInterface
    public interface BatchRunner {
        List<Runner.RunResult> runBatch(List<Runner.Program> programs, List<Runner.Job> jobs, Map<String, Path> files);
    }

    private final List<TestSource> sources;
    private final BatchRunner runner;

    public BehaviorVerifier(TestSourceRegistry registry, Runner runner) {
        this(registry, (programs, jobs, files) -> runner.runBatch(programs, jobs, Runner.Rewrite.RUN, files));
    }

    public BehaviorVerifier(TestSourceRegistry registry, BatchRunner runner) {
        this.sources = registry.sources();
        this.runner = runner;
    }

    public VerifyResult verify(TestContext ctx) {
        if (StdinUsage.readsStdin(TestContext.javaSources(ctx.currentFiles()))
                && sources.stream().noneMatch(s -> s.providesInput(ctx))) {
            return new VerifyResult(VerifyResult.Status.BLOCKED, List.of(), List.of(WARN_STDIN));
        }
        Batch batch = new Batch();
        List<TestSource.Prepared> prepared = new ArrayList<>();
        for (TestSource s : sources) prepared.add(s.prepare(ctx, batch));
        List<Runner.RunResult> rs = batch.jobs().isEmpty() ? List.of()
                : runner.runBatch(batch.programs(), batch.jobs(), batch.files());
        List<TestResult> results = new ArrayList<>();
        for (TestSource.Prepared p : prepared) results.addAll(p.results(rs));
        return verdict(results);
    }

    /** Статус и предупреждения по результатам всех источников (без blocked — он решается до запуска). */
    static VerifyResult verdict(List<TestResult> results) {
        List<String> warnings = new ArrayList<>();
        boolean noisy = results.stream().anyMatch(Noise::mostlyNoise);
        if (noisy) warnings.add(WARN_NOISY);
        long skipped = results.stream().filter(TestResult::skipped).count();
        if (skipped > 0) warnings.add(skippedWarning(skipped));
        List<String> unstable = results.stream().filter(TestResult::unstableOriginal).map(TestResult::name).toList();
        if (!unstable.isEmpty()) warnings.add(unstableWarning(unstable));
        if (results.isEmpty()) warnings.add(WARN_NO_TESTS);
        VerifyResult.Status status;
        if (results.stream().anyMatch(r -> !r.passed())) status = VerifyResult.Status.RED;
        else if (noisy || !unstable.isEmpty() || results.isEmpty()) status = VerifyResult.Status.INCOMPLETE;
        else status = VerifyResult.Status.GREEN;
        return new VerifyResult(status, results, warnings);
    }

    /** Предупреждение о недетерминированном завершении оригинала с именами тестов. */
    static String unstableWarning(List<String> tests) {
        return TestResult.UNSTABLE_ORIGINAL + " — проверка неполная (тесты: " + String.join(", ", tests) + ")";
    }

    /** «1 тест пропущен», «2 теста пропущено», «5 тестов пропущено» + «(@Disabled)». */
    static String skippedWarning(long n) {
        long m100 = n % 100;
        long m10 = n % 10;
        String text;
        if (m10 == 1 && m100 != 11) text = n + " тест пропущен";
        else if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) text = n + " теста пропущено";
        else text = n + " тестов пропущено";
        return text + " (@Disabled)";
    }
}
