package blueprints.testing.junit;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import blueprints.runner.Runner;
import blueprints.testing.TestContext;
import blueprints.testing.TestResult;
import blueprints.testing.TestStatus;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Реальный console launcher в Docker. Пропускается, если docker info не проходит. */
class JUnitTestSourceDockerTest {

    private static final String MAIN = """
            package com.demo;
            public class Main {
                public static void main(String[] a) throws Exception {
                    System.out.print(java.nio.file.Files.readString(java.nio.file.Path.of("/etc/hostname")).trim());
                }
            }
            """;
    /** Падает с сообщением = hostname контейнера: так видно, где выполнился JUnit. */
    private static final String HOST_TEST = """
            package com.demo;
            import static org.junit.jupiter.api.Assertions.fail;
            import org.junit.jupiter.api.Test;
            class HostTest {
                @Test void host() throws Exception {
                    fail(java.nio.file.Files.readString(java.nio.file.Path.of("/etc/hostname")).trim());
                }
            }
            """;

    private static boolean dockerUp() {
        try {
            Process p = new ProcessBuilder("docker", "info").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            return p.waitFor() == 0;
        } catch (Exception e) {
            return false;
        }
    }

    private static Runner runner(Path tmp) {
        assumeTrue(dockerUp(), "docker недоступен");
        var d = Runner.Config.defaults();
        return new Runner(new Runner.Config(tmp, d.image(), d.memory(), d.cpus(), Duration.ofSeconds(10)));
    }

    private static TestContext ctx(Map<String, String> extraTests) {
        Map<String, String> files = new LinkedHashMap<>();
        files.put("src/com/demo/Calc.java", JUnitTestSourceTest.CALC);
        files.put("src/com/demo/Main.java", MAIN);
        files.put("tests/CalcTest.java", JUnitTestSourceTest.CALC_TEST);
        files.putAll(extraTests);
        return new TestContext(files, files, "com.demo.Main");
    }

    @Test
    void runsTestsAgainstPrivateMethods(@TempDir Path tmp) {
        List<TestResult> rs = new JUnitTestSource(runner(tmp)).run(ctx(Map.of()));
        assertEquals(List.of("com.demo.CalcTest.twicePrivate", "com.demo.CalcTest.addWrong"), rs.stream().map(TestResult::name).toList(), rs.toString());
        assertEquals(TestStatus.PASSED, rs.get(0).status(), rs.toString());
        assertEquals(TestStatus.FAILED, rs.get(1).status());
        assertEquals("expected: <5> but was: <4>", rs.get(1).error());
    }

    @Test
    void brokenTestIsCompileError(@TempDir Path tmp) {
        List<TestResult> rs = new JUnitTestSource(runner(tmp)).run(ctx(Map.of("tests/BrokenTest.java", JUnitTestSourceTest.BROKEN_TEST)));
        assertTrue(rs.stream().allMatch(r -> r.status() == TestStatus.COMPILE_ERROR), rs.toString());
        assertTrue(rs.get(0).error().startsWith(JUnitTestSource.TESTS_BROKEN), rs.get(0).error());
    }

    /** tests/a/XTest.java и tests/b/XTest.java с разными package — разные тесты (имя с полным именем класса). */
    @Test
    void sameNameTestsInDifferentPackages(@TempDir Path tmp) {
        String test = """
                package %s;
                import static org.junit.jupiter.api.Assertions.assertEquals;
                import org.junit.jupiter.api.Test;
                class XTest {
                    @Test void v() { assertEquals(%s, new V().v()); }
                }
                """;
        Map<String, String> files = Map.of(
                "src/a/V.java", "package a; public class V { private int v() { return 1; } }",
                "src/b/V.java", "package b; public class V { private int v() { return 2; } }",
                "tests/a/XTest.java", test.formatted("a", "1"),
                "tests/b/XTest.java", test.formatted("b", "3"));
        List<TestResult> rs = new JUnitTestSource(runner(tmp)).run(new TestContext(files, files, null));
        Map<String, TestStatus> byName = new LinkedHashMap<>();
        rs.forEach(r -> byName.put(r.name(), r.status()));
        assertEquals(Map.of("a.XTest.v", TestStatus.PASSED, "b.XTest.v", TestStatus.FAILED), byName, rs.toString());
    }

    /** Как в BE-10: IO-запуск и JUnit — один пакет runBatch, один контейнер. */
    @Test
    void ioAndJUnitShareOneContainer(@TempDir Path tmp) {
        Runner runner = runner(tmp);
        TestContext ctx = ctx(Map.of("tests/HostTest.java", HOST_TEST));
        JUnitTestSource junit = new JUnitTestSource(runner);
        JUnitTestSource.Plan plan = junit.plan(ctx, 1).orElseThrow();
        var io = new Runner.Program(TestContext.javaSources(ctx.currentFiles()), ctx.mainClass());
        var rs = runner.runBatch(List.of(io, plan.program()), List.of(new Runner.Job(0, ""), plan.job(), new Runner.Job(0, "")),
                Runner.Rewrite.RUN, plan.files());
        String host = rs.get(0).stdout();
        assertFalse(host.isBlank(), rs.toString());
        assertEquals(host, rs.get(2).stdout(), "IO-запуск после JUnit — в том же контейнере");
        List<TestResult> results = junit.results(plan, rs.get(1));
        TestResult hostTest = results.stream().filter(r -> r.name().equals("com.demo.HostTest.host")).findFirst().orElseThrow();
        assertEquals(TestStatus.FAILED, hostTest.status());
        assertEquals(host, hostTest.error(), "JUnit выполнился в том же контейнере, что и IO");
        assertEquals(3, results.size(), results.toString());
    }
}
