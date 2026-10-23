package blueprints.testing;

import static org.junit.jupiter.api.Assertions.*;

import blueprints.runner.Runner;
import blueprints.testing.io.IoTestSource;
import blueprints.testing.io.OutputComparator;
import blueprints.testing.junit.JUnitTestSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Вердикт, шум, блокировка и общий пакет — на подменённом запуске (без Docker). */
class BehaviorVerifierTest {

    private static final String PROGRAM = "class Main { public static void main(String[] a) { /* %s */ } }";
    private static final String READER = "class Main { public static void main(String[] a) { new java.util.Scanner(System.in); } }";
    private static final String JUNIT_XML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <testsuite name="JUnit Jupiter" tests="2">
              <testcase name="ok()" classname="MainTest" time="0.001"/>
              <testcase name="later()" classname="MainTest" time="0"><skipped/></testcase>
            </testsuite>
            """;

    /**
     * Фейк пакетного запуска: java-запуск оригинала отвечает {@code orig1}/{@code orig2} (первый и второй прогон
     * одного stdin), текущей версии — {@code cur}; command-запуск (JUnit) — XML-отчёт.
     */
    private static final class Fake implements BehaviorVerifier.BatchRunner {
        final List<List<Runner.Job>> calls = new ArrayList<>();
        final List<List<Runner.Program>> programs = new ArrayList<>();
        final List<Map<String, Path>> files = new ArrayList<>();
        String cur = "a\nb\n";
        String orig1 = "a\nb\n";
        String orig2 = "a\nb\n";
        /** Второй прогон оригинала: код выхода и stderr (по умолчанию — как у первого). */
        int orig2Exit = 0;
        String orig2Err = "";

        @Override
        public List<Runner.RunResult> runBatch(List<Runner.Program> ps, List<Runner.Job> jobs, Map<String, Path> fs) {
            calls.add(jobs);
            programs.add(ps);
            files.add(fs);
            Map<String, Integer> seen = new LinkedHashMap<>();
            return jobs.stream().map(j -> {
                if (j.command() != null) return ok(JUNIT_XML);
                boolean orig = ps.get(j.program()).sources().values().stream().anyMatch(s -> s.contains("orig"));
                if (!orig) return ok(cur);
                int n = seen.merge(j.stdin(), 1, Integer::sum);
                return n == 1 ? ok(orig1) : new Runner.RunResult(true, List.of(), orig2, orig2Err, orig2Exit, false, 3, false);
            }).toList();
        }
    }

    private static Runner.RunResult ok(String out) {
        return new Runner.RunResult(true, List.of(), out, "", 0, false, 3, false);
    }

    private static TestContext ctx(String origCode, String curCode, Map<String, String> tests) {
        Map<String, String> orig = new LinkedHashMap<>(Map.of("Main.java", origCode));
        Map<String, String> cur = new LinkedHashMap<>(Map.of("Main.java", curCode));
        cur.putAll(tests);
        return new TestContext(orig, cur, "Main");
    }

    private static TestContext ctx(Map<String, String> tests) {
        return ctx(PROGRAM.formatted("orig"), PROGRAM.formatted("cur"), tests);
    }

    private static BehaviorVerifier verifier(Fake fake, Path launcher) {
        TestSourceRegistry reg = new TestSourceRegistry(List.of(
                new IoTestSource((p, j) -> { throw new AssertionError("свой пакет IO не должен запускаться"); },
                        new OutputComparator()),
                new JUnitTestSource((p, j, f) -> { throw new AssertionError("свой пакет JUnit не должен запускаться"); },
                        () -> launcher)));
        return new BehaviorVerifier(reg, fake);
    }

    private static BehaviorVerifier ioOnly(Fake fake) {
        return verifier(fake, Path.of("unused.jar"));
    }

    @Test
    void ioAndJUnitShareOneBatchWithDoubleOriginalRun(@TempDir Path tmp) throws Exception {
        Path jar = Files.createFile(tmp.resolve("launcher.jar"));
        Fake fake = new Fake();
        VerifyResult r = verifier(fake, jar).verify(ctx(Map.of(
                "tests/a.in", "1\n", "tests/b.in", "2\n",
                "tests/MainTest.java", "class MainTest { @org.junit.jupiter.api.Test void ok() {} }")));
        assertEquals(1, fake.calls.size(), "один пакет — один контейнер на весь verify");
        List<Runner.Job> jobs = fake.calls.get(0);
        assertEquals(List.of(new Runner.Job(0, "1\n"), new Runner.Job(0, "2\n"),
                new Runner.Job(1, "1\n"), new Runner.Job(1, "2\n"),
                new Runner.Job(1, "1\n"), new Runner.Job(1, "2\n")), jobs.subList(0, 6), "текущая, оригинал, оригинал ещё раз");
        assertEquals(7, jobs.size());
        assertEquals(2, jobs.get(6).program(), "JUnit — третья программа того же пакета");
        assertTrue(jobs.get(6).command().contains(Runner.programDir(2)));
        assertNull(fake.programs.get(0).get(0).rewrite(), "IO-программы — с rewrite пакета (RUN, seed)");
        assertNull(fake.programs.get(0).get(1).rewrite());
        assertEquals(Map.of(JUnitTestSource.LAUNCHER, jar), fake.files.get(0));
        assertEquals(List.of("a", "b", "MainTest.ok", "MainTest.later"), r.results().stream().map(TestResult::name).toList());
        assertEquals(VerifyResult.Status.GREEN, r.status(), r.toString());
        assertEquals(List.of("1 тест пропущен (@Disabled)"), r.warnings());
    }

    @Test
    void noisyLinesAreIgnoredAndReported() {
        Fake fake = new Fake();
        fake.orig1 = "start\nt=1\nx\nend\n";
        fake.orig2 = "start\nt=2\nx\nend\n";
        fake.cur = "start\nt=3\nx\nend\n";
        VerifyResult r = ioOnly(fake).verify(ctx(Map.of("tests/a.in", "", "tests/m.in", "m", "tests/m.out", "start\nT\nx\nend\n")));
        TestResult a = r.results().get(0);
        assertEquals(TestStatus.PASSED, a.status(), a.toString());
        assertEquals(List.of(2), a.noisyLines());
        assertEquals("start\nt=1\nx\nend\n", a.expected(), "эталон — первый прогон оригинала");
        TestResult m = r.results().get(1);
        assertEquals(TestStatus.PASSED, m.status(), "manual: шумная строка тоже не сравнивается");
        assertEquals(List.of(2), m.noisyLines());
        assertEquals(VerifyResult.Status.GREEN, r.status());
        assertEquals(List.of(), r.warnings());
    }

    @Test
    void differenceOutsideNoiseIsRed() {
        Fake fake = new Fake();
        fake.orig1 = "start\nt=1\nend\n";
        fake.orig2 = "start\nt=2\nend\n";
        fake.cur = "START\nt=3\nend\n";
        VerifyResult r = ioOnly(fake).verify(ctx(Map.of("tests/a.in", "")));
        assertEquals(TestStatus.FAILED, r.results().get(0).status());
        assertEquals(VerifyResult.Status.RED, r.status());
    }

    /** Второй прогон оригинала длиннее: лишние строки шумные, и в текущей версии их может не быть. */
    @Test
    void differentLineCountBetweenOriginalRuns() {
        Fake fake = new Fake();
        fake.orig1 = "a\nb\nc\nd\n";
        fake.orig2 = "a\nb\nc\nd\ne\n";
        fake.cur = "a\nb\nc\nd\n";
        VerifyResult r = ioOnly(fake).verify(ctx(Map.of("tests/a.in", "")));
        assertEquals(List.of(5), r.results().get(0).noisyLines());
        assertEquals(VerifyResult.Status.GREEN, r.status(), "1 шумная из 5 — не больше половины");
    }

    /** Оригинал завершается по-разному (код выхода/исключение) — не ложный red, а incomplete с именем теста. */
    @Test
    void unstableOriginalExitIsIncompleteNotRed() {
        String warning = "оригинал завершается недетерминированно (разный код выхода/исключение между двумя прогонами)"
                + " — проверка неполная (тесты: a, b)";
        Fake exit = new Fake();
        exit.orig2Exit = 1;
        VerifyResult r = ioOnly(exit).verify(ctx(Map.of("tests/a.in", "1", "tests/b.in", "2")));
        assertEquals(List.of(TestStatus.PASSED, TestStatus.PASSED), r.results().stream().map(TestResult::status).toList());
        assertEquals(TestResult.UNSTABLE_ORIGINAL, r.results().get(0).error());
        assertEquals(VerifyResult.Status.INCOMPLETE, r.status());
        assertEquals(List.of(warning), r.warnings());

        Fake exception = new Fake();
        exception.orig2Err = "Exception in thread \"main\" java.lang.IllegalStateException: boom\n\tat Main.main(Main.java:1)\n";
        VerifyResult e = ioOnly(exception).verify(ctx(Map.of("tests/a.in", "1", "tests/b.in", "2")));
        assertEquals(VerifyResult.Status.INCOMPLETE, e.status(), e.toString());
        assertEquals(List.of(warning), e.warnings());

        // stdout вне шума всё равно сравнивается: расхождение там — red
        Fake broken = new Fake();
        broken.orig2Exit = 1;
        broken.cur = "a\nX\n";
        VerifyResult b = ioOnly(broken).verify(ctx(Map.of("tests/a.in", "1")));
        assertEquals(TestStatus.FAILED, b.results().get(0).status());
        assertEquals(VerifyResult.Status.RED, b.status());

        // одинаковое завершение обоих прогонов — обычное сравнение, без пометки
        VerifyResult same = ioOnly(new Fake()).verify(ctx(Map.of("tests/a.in", "1")));
        assertNull(same.results().get(0).error());
        assertEquals(VerifyResult.Status.GREEN, same.status());
    }

    @Test
    void mostlyNoiseIsIncomplete() {
        Fake fake = new Fake();
        fake.orig1 = "1\n2\n3\nok\n";
        fake.orig2 = "4\n5\n6\nok\n";
        fake.cur = "7\n8\n9\nok\n";
        VerifyResult r = ioOnly(fake).verify(ctx(Map.of("tests/a.in", "")));
        assertEquals(List.of(1, 2, 3), r.results().get(0).noisyLines());
        assertEquals(TestStatus.PASSED, r.results().get(0).status());
        assertEquals(VerifyResult.Status.INCOMPLETE, r.status());
        assertEquals(List.of(BehaviorVerifier.WARN_NOISY), r.warnings());
    }

    @Test
    void stdinReaderWithoutInputTestsIsBlockedAndNothingRuns() {
        Fake fake = new Fake();
        VerifyResult r = ioOnly(fake).verify(ctx(READER.replace("{", "{ /* orig */"), READER, Map.of()));
        assertEquals(VerifyResult.Status.BLOCKED, r.status());
        assertEquals(List.of(BehaviorVerifier.WARN_STDIN), r.warnings());
        assertTrue(r.results().isEmpty());
        assertTrue(fake.calls.isEmpty(), "тесты не запускались");

        // IO-тест есть, но с пустым stdin — входных данных нет
        assertEquals(VerifyResult.Status.BLOCKED,
                ioOnly(new Fake()).verify(ctx(READER.replace("{", "{ /* orig */"), READER, Map.of("tests/e.in", ""))).status());
    }

    @Test
    void stdinReaderWithInputTestIsNotBlocked() {
        Fake fake = new Fake();
        VerifyResult r = ioOnly(fake).verify(ctx(READER.replace("{", "{ /* orig */"), READER, Map.of("tests/a.in", "5\n")));
        assertEquals(VerifyResult.Status.GREEN, r.status(), r.toString());
        assertEquals(1, fake.calls.size());
    }

    /** Только текущая версия решает: оригинал читал stdin, текущая больше нет — не blocked. */
    @Test
    void programWithoutStdinIsNotBlocked() {
        Fake fake = new Fake();
        VerifyResult r = ioOnly(fake).verify(ctx(READER, PROGRAM.formatted("cur"), Map.of()));
        assertEquals(VerifyResult.Status.INCOMPLETE, r.status(), "тестов нет — не green");
        assertEquals(List.of("Тестов пока нет — проверена компиляция. Добавьте IO-тест (можно сохранить из запуска), "
                + "и каждое изменение будет подтверждаться автоматически"), r.warnings());
        assertTrue(fake.calls.isEmpty(), "пустой пакет не запускается");
    }

    private static TestResult res(TestStatus s, String error, List<Integer> noisy) {
        return new TestResult("t", "io", s, 1, error, "1\n2\n3\n", "1\n2\n3\n", noisy);
    }

    @Test
    void verdictOnMixedResults() {
        TestResult ok = res(TestStatus.PASSED, null, List.of());
        TestResult fixed = res(TestStatus.PASSED, IoTestSource.FIXED_BY_EDIT, List.of());
        TestResult skipped = res(TestStatus.PASSED, "пропущен: не сейчас", List.of());
        TestResult noisy = res(TestStatus.PASSED, null, List.of(1, 2));
        assertEquals(VerifyResult.Status.GREEN, BehaviorVerifier.verdict(List.of(ok, fixed, skipped)).status(),
                "«починенный» manual и пропущенный JUnit — passed");
        for (TestStatus bad : List.of(TestStatus.FAILED, TestStatus.ORIGINAL_FAILS, TestStatus.COMPILE_ERROR)) {
            assertEquals(VerifyResult.Status.RED, BehaviorVerifier.verdict(List.of(ok, res(bad, "x", List.of()))).status(), bad.name());
        }
        VerifyResult redAndNoisy = BehaviorVerifier.verdict(List.of(noisy, res(TestStatus.FAILED, "x", List.of())));
        assertEquals(VerifyResult.Status.RED, redAndNoisy.status(), "расхождение вне шума важнее неполноты");
        assertEquals(List.of(BehaviorVerifier.WARN_NOISY), redAndNoisy.warnings());
        assertEquals(VerifyResult.Status.INCOMPLETE, BehaviorVerifier.verdict(List.of(ok, noisy, skipped)).status());
    }

    @Test
    void skippedWarningCountsAndPlurals() {
        TestResult skipped = res(TestStatus.PASSED, "пропущен", List.of());
        TestResult notSkipped = res(TestStatus.PASSED, "оригинал не компилируется", List.of());
        assertEquals(List.of("2 теста пропущено (@Disabled)"),
                BehaviorVerifier.verdict(List.of(skipped, skipped, notSkipped)).warnings());
        assertEquals("5 тестов пропущено (@Disabled)", BehaviorVerifier.skippedWarning(5));
        assertEquals("11 тестов пропущено (@Disabled)", BehaviorVerifier.skippedWarning(11));
        assertEquals("21 тест пропущен (@Disabled)", BehaviorVerifier.skippedWarning(21));
        assertEquals("1 тест пропущен (@Disabled)", BehaviorVerifier.skippedWarning(1));
    }

    /** Новый источник подключается регистрацией: без prepare — прогоняется сам, с prepare — в общем пакете. */
    @Test
    void anyRegisteredSourceTakesPart() {
        TestSource standalone = new TestSource() {
            public String id() { return "x"; }
            public List<TestResult> run(TestContext ctx) {
                return List.of(new TestResult("own", "x", TestStatus.PASSED, 0, null, null, null, List.of()));
            }
        };
        TestSource batched = new TestSource() {
            public String id() { return "y"; }
            public List<TestResult> run(TestContext ctx) { throw new AssertionError(); }
            public Prepared prepare(TestContext ctx, Batch batch) {
                int p = batch.addProgram(new Runner.Program(Map.of("Main.java", "orig"), "Main"));
                int j = batch.addJob(new Runner.Job(p, "in"));
                return rs -> List.of(new TestResult("shared:" + rs.get(j).stdout(), "y", TestStatus.PASSED, 0, null, null, null, List.of()));
            }
            public boolean providesInput(TestContext ctx) { return true; }
        };
        Fake fake = new Fake();
        fake.orig1 = "out";
        VerifyResult r = new BehaviorVerifier(new TestSourceRegistry(List.of(standalone, batched)), fake)
                .verify(ctx(READER.replace("{", "{ /* orig */"), READER, Map.of()));
        assertEquals(List.of("own", "shared:out"), r.results().stream().map(TestResult::name).toList());
        assertEquals(VerifyResult.Status.GREEN, r.status(), "вход дал зарегистрированный источник — не blocked");
        assertEquals(1, fake.calls.size());
    }
}
