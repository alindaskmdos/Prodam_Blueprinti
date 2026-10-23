package blueprints.testing.io;

import static org.junit.jupiter.api.Assertions.*;

import blueprints.runner.Runner;
import blueprints.testing.TestContext;
import blueprints.testing.TestResult;
import blueprints.testing.TestStatus;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

/** Режимы original/manual на подменённом пакетном запуске (без Docker). */
class IoTestSourceTest {

    private static final Map<String, String> ORIG = Map.of("src/Main.java", "class Main { /* orig */ }", "tests/T.java", "junit");
    private static final Map<String, String> CUR = Map.of("src/Main.java", "class Main { /* cur */ }");

    /** Фейк: «программа» — функция stdin → результат; индекс 0 — текущая, 1 — оригинал. */
    private static final class Fake implements IoTestSource.BatchRunner {
        final List<List<Runner.Job>> calls = new ArrayList<>();
        final List<List<Runner.Program>> programs = new ArrayList<>();
        final Function<String, Runner.RunResult> orig;
        final Function<String, Runner.RunResult> cur;

        Fake(Function<String, Runner.RunResult> orig, Function<String, Runner.RunResult> cur) {
            this.orig = orig;
            this.cur = cur;
        }

        @Override
        public List<Runner.RunResult> runBatch(List<Runner.Program> ps, List<Runner.Job> jobs) {
            calls.add(jobs);
            programs.add(ps);
            return jobs.stream().map(j -> {
                var f = ps.get(j.program()).sources().get("src/Main.java").contains("orig") ? orig : cur;
                return f.apply(j.stdin());
            }).toList();
        }
    }

    private static Runner.RunResult ok(String out) {
        return new Runner.RunResult(true, List.of(), out, "", 0, false, 7, false);
    }

    private static Runner.RunResult echo(String in) {
        return ok(in);
    }

    private static Runner.RunResult upper(String in) {
        return ok(in.toUpperCase());
    }

    private static final Function<String, Runner.RunResult> NO_COMPILE =
            in -> new Runner.RunResult(false, List.of("Main.java:1: boom"), "", "", -1, false, 0, false);
    private static final Function<String, Runner.RunResult> HANGS =
            in -> new Runner.RunResult(true, List.of(), "", "", -1, true, 10000, false);
    private static final Function<String, Runner.RunResult> ABORTED =
            in -> new Runner.RunResult(true, List.of(), "", "прогон прерван: песочница не отвечала", -1, false, 0, false, true);

    private static List<TestResult> run(Fake fake, IoTestCase... tests) {
        return new IoTestSource(fake, new OutputComparator()).run(List.of(tests), new TestContext(ORIG, CUR, "Main"));
    }

    private static IoTestCase original(String name, String stdin) {
        return new IoTestCase(name, stdin, IoTestCase.Mode.ORIGINAL, null, List.of());
    }

    private static IoTestCase manual(String name, String stdin, String expected) {
        return new IoTestCase(name, stdin, IoTestCase.Mode.MANUAL, expected, List.of());
    }

    @Test
    void wholeRunIsOneBatchWithBothVersions() {
        var fake = new Fake(IoTestSourceTest::echo, IoTestSourceTest::echo);
        run(fake, original("a", "1"), manual("b", "2", "2"));
        assertEquals(1, fake.calls.size(), "один пакет (контейнер) на весь прогон");
        assertEquals(List.of(new Runner.Job(0, "1"), new Runner.Job(0, "2"), new Runner.Job(1, "1"), new Runner.Job(1, "2")),
                fake.calls.get(0));
        assertFalse(fake.programs.get(0).get(0).sources().containsKey("tests/T.java"));
        assertFalse(fake.programs.get(0).get(1).sources().containsKey("tests/T.java"), "tests/*.java не входят в программу");
        assertEquals("Main", fake.programs.get(0).get(1).mainClass());
    }

    @Test
    void originalModeComparesWithOriginalRun() {
        var fake = new Fake(IoTestSourceTest::echo, IoTestSourceTest::upper);
        var rs = run(fake, original("same", "1\n"), original("diff", "a\n"));
        assertEquals(TestStatus.PASSED, rs.get(0).status());
        assertEquals(TestStatus.FAILED, rs.get(1).status());
        assertEquals("a\n", rs.get(1).expected());
        assertEquals("A\n", rs.get(1).actual());
        assertEquals("io", rs.get(1).type());
        assertEquals(7, rs.get(1).durationMs());
        assertTrue(rs.get(1).error().startsWith("stdout, строка 1"), rs.get(1).error());
    }

    @Test
    void manualModeFourCases() {
        var fake = new Fake(IoTestSourceTest::echo, IoTestSourceTest::upper);
        var rs = run(fake,
                manual("bothPass", "1", "1"),     // обе проходят
                manual("fixed", "x", "X"),        // текущая проходит, оригинал нет → passed + пояснение
                manual("regress", "y", "y"),      // оригинал проходит, текущая нет → failed
                manual("both", "z", "nope"));     // не проходят обе → original_fails
        assertEquals(List.of(TestStatus.PASSED, TestStatus.PASSED, TestStatus.FAILED, TestStatus.ORIGINAL_FAILS),
                rs.stream().map(TestResult::status).toList());
        assertNull(rs.get(0).error());
        assertEquals("оригинал не проходит этот тест — правка его исправила", rs.get(1).error());
        assertFalse(rs.get(2).error().contains("оригинал"), rs.get(2).error());
        assertTrue(rs.get(3).error().startsWith("оригинал тоже не проходит этот тест; stdout"), rs.get(3).error());
    }

    @Test
    void manualWhenOriginalDoesNotCompileOrHangs() {
        var noCompile = run(new Fake(NO_COMPILE, IoTestSourceTest::upper), manual("f", "a", "a"), manual("p", "a", "A"));
        assertEquals(TestStatus.FAILED, noCompile.get(0).status());
        assertTrue(noCompile.get(0).error().contains("оригинал не компилируется"), noCompile.get(0).error());
        assertFalse(noCompile.get(0).error().contains("тоже"));
        assertEquals(TestStatus.PASSED, noCompile.get(1).status());
        assertEquals("оригинал не компилируется", noCompile.get(1).error());

        var hang = run(new Fake(HANGS, IoTestSourceTest::upper), manual("f", "a", "a")).get(0);
        assertEquals(TestStatus.FAILED, hang.status());
        assertTrue(hang.error().contains("оригинал завис по таймауту"), hang.error());
    }

    @Test
    void compileErrorAndTimeouts() {
        var rs = run(new Fake(IoTestSourceTest::echo, NO_COMPILE), original("o", "1"), manual("m", "1", "1"));
        assertTrue(rs.stream().allMatch(r -> r.status() == TestStatus.COMPILE_ERROR));
        assertEquals("Main.java:1: boom", rs.get(0).error());

        var t = run(new Fake(IoTestSourceTest::echo, HANGS), original("o", "1")).get(0);
        assertEquals(TestStatus.FAILED, t.status());
        assertEquals("timeout", t.error());

        var o = run(new Fake(HANGS, IoTestSourceTest::echo), original("o", "1")).get(0);
        assertEquals(TestStatus.ORIGINAL_FAILS, o.status());
        assertEquals("оригинал завис по таймауту — эталон не получен", o.error());
        assertEquals("оригинал не компилируется — эталон не получен",
                run(new Fake(NO_COMPILE, IoTestSourceTest::echo), original("o", "1")).get(0).error());
    }

    @Test
    void abortedRunsAreNotTimeouts() {
        var cur = run(new Fake(IoTestSourceTest::echo, ABORTED), original("o", "1")).get(0);
        assertEquals(TestStatus.FAILED, cur.status());
        assertEquals("прогон прерван: песочница не отвечала", cur.error());
        var orig = run(new Fake(ABORTED, IoTestSourceTest::echo), original("o", "1")).get(0);
        assertEquals(TestStatus.FAILED, orig.status());
        assertTrue(orig.error().startsWith("оригинал не запущен: прогон прерван"), orig.error());
    }

    @Test
    void truncatedOutputNeverPasses() {
        Function<String, Runner.RunResult> big = in -> new Runner.RunResult(true, List.of(), "x", "", 0, false, 1, true);
        var o = run(new Fake(big, big), original("o", ""), manual("m", "", "x"));
        assertEquals(List.of(TestStatus.FAILED, TestStatus.ORIGINAL_FAILS), o.stream().map(TestResult::status).toList());
        assertEquals("вывод больше 1 МБ, сравнение невозможно", o.get(0).error());
        assertTrue(o.get(1).error().endsWith("вывод больше 1 МБ, сравнение невозможно"));
    }

    @Test
    void exitCodeAndIgnoreLinesInOriginalMode() {
        var fake = new Fake(in -> new Runner.RunResult(true, List.of(), "t=1\nok\n", "", 3, false, 1, false),
                in -> new Runner.RunResult(true, List.of(), "t=2\nok\n", "", 3, false, 1, false));
        var ignoring = new IoTestCase("ign", "", IoTestCase.Mode.ORIGINAL, null, List.of(1));
        var rs = run(fake, ignoring, original("strict", ""));
        assertEquals(TestStatus.PASSED, rs.get(0).status());
        assertEquals(TestStatus.FAILED, rs.get(1).status());

        var exit = new Fake(in -> new Runner.RunResult(true, List.of(), "", "", 3, false, 1, false),
                in -> new Runner.RunResult(true, List.of(), "", "", 0, false, 1, false));
        assertEquals("код выхода: ожидался 3, получен 0", run(exit, original("e", "")).get(0).error());
    }

    @Test
    void readsTestsFromCurrentFiles() {
        var fake = new Fake(IoTestSourceTest::echo, IoTestSourceTest::echo);
        Map<String, String> cur = Map.of("src/Main.java", "class Main {}", "tests/a.in", "1", "tests/b.json", "{\"stdin\":\"2\"}");
        var rs = new IoTestSource(fake, new OutputComparator()).run(new TestContext(ORIG, cur, null));
        assertEquals(List.of("a", "b"), rs.stream().map(TestResult::name).toList());
        assertEquals(List.of(), new IoTestSource(fake, new OutputComparator()).run(new TestContext(ORIG, CUR, null)));
    }
}
