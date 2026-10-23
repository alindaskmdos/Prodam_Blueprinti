package blueprints.testing.junit;

import static org.junit.jupiter.api.Assertions.*;

import blueprints.runner.Runner;
import blueprints.testing.TestContext;
import blueprints.testing.TestResult;
import blueprints.testing.TestStatus;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class JUnitTestSourceTest {

    static final String CALC = """
            package com.demo;
            public class Calc {
                private int twice(int x) { return x * 2; }
                public int add(int a, int b) { return a + b; }
            }
            """;
    static final String CALC_TEST = """
            package com.demo;
            import static org.junit.jupiter.api.Assertions.assertEquals;
            import org.junit.jupiter.api.Test;
            class CalcTest {
                @Test void twicePrivate() { assertEquals(4, new Calc().twice(2)); }
                @Test void addWrong() { assertEquals(5, new Calc().add(2, 2)); }
            }
            """;
    static final String BROKEN_TEST = """
            package com.demo;
            import org.junit.jupiter.api.Test;
            class BrokenTest {
                @Test void t() { new Calc().noSuchMethod(); }
            }
            """;

    private static TestContext ctx(Map<String, String> files) {
        return new TestContext(files, files, null);
    }

    private static JUnitTestSource source(List<List<Runner.Job>> calls, Runner.RunResult answer) {
        return new JUnitTestSource((programs, jobs, files) -> {
            calls.add(jobs);
            return jobs.stream().map(j -> answer).toList();
        }, LauncherJar::path);
    }

    @Test
    void findsTestFilesWithPackages() {
        var tests = JUnitTestSource.testFiles(Map.of(
                "tests/CalcTest.java", CALC_TEST,
                "tests/PlainTest.java", "class PlainTest {}",
                "tests/b/CalcTest.java", "package b;\nclass CalcTest {}",
                "tests/sum.json", "{}",
                "src/com/demo/Calc.java", CALC));
        assertEquals(List.of(new JUnitTestSource.TestFile("tests/CalcTest.java", "com.demo.CalcTest"),
                new JUnitTestSource.TestFile("tests/PlainTest.java", "PlainTest"),
                new JUnitTestSource.TestFile("tests/b/CalcTest.java", "b.CalcTest")), tests);
    }

    @Test
    void noTestsNoRun() {
        List<List<Runner.Job>> calls = new ArrayList<>();
        var src = source(calls, null);
        assertEquals(List.of(), src.run(ctx(Map.of("src/com/demo/Calc.java", CALC))));
        assertTrue(calls.isEmpty());
    }

    @Test
    void planCompilesTestsWithCodeAndRewritesOnlyCopy() {
        Map<String, String> files = Map.of("src/com/demo/Calc.java", CALC, "tests/CalcTest.java", CALC_TEST, "tests/a.json", "{}");
        var plan = new JUnitTestSource(new Runner(Runner.Config.defaults())).plan(ctx(files), 2).orElseThrow();
        assertEquals(Runner.Rewrite.JUNIT, plan.program().rewrite());
        assertTrue(plan.program().rewrite().packagePrivate());
        assertEquals(Map.of("src/com/demo/Calc.java", CALC, "tests/CalcTest.java", CALC_TEST), plan.program().sources(),
                "исходники в плане — чистые, переписывает Runner в копии");
        assertEquals(List.of(LauncherJar.path()), plan.program().classpath());
        assertEquals(Map.of(JUnitTestSource.LAUNCHER, LauncherJar.path()), plan.files());
        assertEquals(2, plan.job().program());
        String cmd = String.join(" ", plan.job().command());
        assertTrue(cmd.contains("--class-path /app/p2"), cmd);
        assertTrue(cmd.contains("--select-class com.demo.CalcTest"), cmd);
        assertTrue(cmd.contains("-jar " + JUnitTestSource.LAUNCHER), cmd);
    }

    /** private-метод из теста доступен только в копии с Rewrite.JUNIT; jar launcher'а даёт JUnit API для компиляции. */
    @Test
    void privateBecomesPackagePrivateOnlyInCopy(@TempDir Path tmp) throws Exception {
        for (Runner.Rewrite rw : List.of(Runner.Rewrite.RUN, Runner.Rewrite.JUNIT)) {
            Path src = tmp.resolve(rw.packagePrivate() + "/src/com/demo");
            Files.createDirectories(src);
            Files.writeString(src.resolve("Calc.java"), Runner.rewrite(CALC, rw), StandardCharsets.UTF_8);
            Files.writeString(src.resolve("CalcTest.java"), Runner.rewrite(CALC_TEST, rw), StandardCharsets.UTF_8);
            List<String> errors = Runner.compile(src.getParent().getParent(), tmp.resolve(rw.packagePrivate() + "/out"),
                    List.of(LauncherJar.path()));
            if (rw.packagePrivate()) assertEquals(List.of(), errors);
            else assertTrue(errors.stream().anyMatch(e -> e.contains("twice")), errors.toString());
        }
        assertTrue(CALC.contains("private int twice"));
    }

    /** Ошибка компиляции не доходит до Docker (Runner возвращает compiled=false без контейнера). */
    @Test
    void brokenTestIsCompileError(@TempDir Path tmp) {
        var runner = new Runner(new Runner.Config(tmp, "no-such-image", "64m", "1", Duration.ofSeconds(1)));
        var rs = new JUnitTestSource(runner).run(ctx(Map.of(
                "src/com/demo/Calc.java", CALC, "tests/CalcTest.java", CALC_TEST, "tests/BrokenTest.java", BROKEN_TEST)));
        assertEquals(List.of("com.demo.BrokenTest", "com.demo.CalcTest"), rs.stream().map(TestResult::name).toList());
        assertTrue(rs.stream().allMatch(r -> r.status() == TestStatus.COMPILE_ERROR && r.type().equals("junit")));
        assertTrue(rs.get(0).error().startsWith(JUnitTestSource.TESTS_BROKEN), rs.get(0).error());
        assertTrue(rs.get(0).error().contains("BrokenTest.java:4"), rs.get(0).error());
    }

    @Test
    void brokenProgramIsCompileErrorWithOwnText(@TempDir Path tmp) {
        var runner = new Runner(new Runner.Config(tmp, "no-such-image", "64m", "1", Duration.ofSeconds(1)));
        var rs = new JUnitTestSource(runner).run(ctx(Map.of(
                "src/com/demo/Calc.java", "package com.demo; public class Calc { int x = \"s\"; }",
                "tests/CalcTest.java", "package com.demo; class CalcTest {}")));
        assertEquals(1, rs.size());
        assertEquals(TestStatus.COMPILE_ERROR, rs.get(0).status());
        assertTrue(rs.get(0).error().startsWith(JUnitTestSource.PROGRAM_BROKEN), rs.get(0).error());
    }

    @Test
    void sandboxFailuresBecomeFailedPerClass() {
        Map<String, String> files = Map.of("src/com/demo/Calc.java", CALC, "tests/CalcTest.java", CALC_TEST);
        var timeout = new Runner.RunResult(true, List.of(), "", "", -1, true, 10_000, false);
        var rs = source(new ArrayList<>(), timeout).run(ctx(files));
        assertEquals(List.of(new TestResult("com.demo.CalcTest", "junit", TestStatus.FAILED, 0, JUnitTestSource.TIMEOUT, null, null, null)), rs);

        var aborted = new Runner.RunResult(true, List.of(), "", "прогон прерван", -1, false, 0, false, true);
        assertEquals("прогон прерван", source(new ArrayList<>(), aborted).run(ctx(files)).get(0).error());

        var noReport = new Runner.RunResult(true, List.of(), "", "Error: OOM", 1, false, 5, false);
        var r = source(new ArrayList<>(), noReport).run(ctx(files)).get(0);
        assertEquals(TestStatus.FAILED, r.status());
        assertTrue(r.error().startsWith("нет отчёта JUnit") && r.error().contains("Error: OOM"), r.error());
    }

    @Test
    void reportIsParsed() {
        Map<String, String> files = Map.of("src/com/demo/Calc.java", CALC, "tests/CalcTest.java", CALC_TEST);
        var ok = new Runner.RunResult(true, List.of(), "<testsuite><testcase name=\"t()\" classname=\"com.demo.CalcTest\" time=\"0.002\"/></testsuite>",
                "", 0, false, 900, false);
        List<List<Runner.Job>> calls = new ArrayList<>();
        var rs = source(calls, ok).run(ctx(files));
        assertEquals(List.of(new TestResult("com.demo.CalcTest.t", "junit", TestStatus.PASSED, 2, null, null, null, null)), rs);
        assertEquals(1, calls.size());
        assertEquals(1, calls.get(0).size(), "один запуск launcher'а на все тесты");
    }
}
