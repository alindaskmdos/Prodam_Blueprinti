package blueprints.runner;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RunnerTest {

    @Test
    void rewriteSeedsRandom() {
        String out = Runner.rewrite("var r = new Random(); var q = new java.util.Random ( ); double d = Math.random();",
                Runner.Rewrite.RUN);
        assertEquals("var r = new Random(42); var q = new java.util.Random(42); double d = bp.rt.Seed.random();", out);
        assertEquals("new Random(7)", Runner.rewrite("new Random(7)", Runner.Rewrite.RUN));
    }

    @Test
    void rewritePackagePrivate() {
        assertEquals("int x; void f() {}",
                Runner.rewrite("private int x; private void f() {}", new Runner.Rewrite(false, true)));
        assertEquals("private int x;", Runner.rewrite("private int x;", Runner.Rewrite.RUN));
    }

    @Test
    void findsMainClasses() {
        Map<String, String> src = Map.of(
                "a/A.java", "package a; class A { public static void main(String[] x) {} }",
                "B.java", "class B { void f() {} }",
                "C.java", "class C { public static void main(final String... x) {} }");
        assertEquals(List.of("C", "a.A"), Runner.findMainClasses(src).stream().sorted().toList());
        assertThrows(IllegalArgumentException.class,
                () -> new Runner(Runner.Config.defaults()).run(src, null, "", Runner.Rewrite.NONE));
    }

    @Test
    void mainClassIsValidated() {
        var r = new Runner(Runner.Config.defaults());
        for (String bad : List.of("-Dx=1", "A B", "A;rm", "--version"))
            assertThrows(IllegalArgumentException.class, () -> r.run(Map.of(), bad, "", Runner.Rewrite.NONE), bad);
    }

    @Test
    void drainTruncates() {
        var sink = new java.io.ByteArrayOutputStream();
        assertTrue(Runner.drain(new java.io.ByteArrayInputStream(new byte[20000]), 10000, sink));
        assertEquals(10000, sink.size());
        var small = new java.io.ByteArrayOutputStream();
        assertFalse(Runner.drain(new java.io.ByteArrayInputStream(new byte[5]), 10000, small));
        assertEquals(5, small.size());
    }

    @Test
    void heapIsThreeQuartersOfMemory() {
        assertEquals("192m", Runner.heapFor("256m"));
        assertEquals("768m", Runner.heapFor("1g"));
    }

    @Test
    void compileReportsErrors(@TempDir Path tmp) throws Exception {
        Path src = tmp.resolve("src");
        Files.createDirectories(src);
        Files.writeString(src.resolve("Ok.java"), "class Ok {}");
        assertEquals(List.of(), Runner.compile(src, tmp.resolve("out")));
        Files.writeString(src.resolve("Bad.java"), "class Bad { int x = \"s\"; }");
        List<String> errors = Runner.compile(src, tmp.resolve("out2"));
        assertEquals(1, errors.size());
        assertTrue(errors.get(0).startsWith("Bad.java:1:"), errors.get(0));
    }

    @Test
    void compileErrorSkipsDocker(@TempDir Path tmp) {
        var r = new Runner(new Runner.Config(tmp, "x", "64m", "1", Duration.ofSeconds(1)))
                .run(Map.of("Bad.java", "class Bad { int x = \"s\"; }"), "Bad", "", Runner.Rewrite.NONE);
        assertFalse(r.compiled());
        assertFalse(r.diagnostics().isEmpty());
    }

    // --- интеграция с реальным Docker ---

    private static boolean dockerUp() {
        try {
            Process p = new ProcessBuilder("docker", "info").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            return p.waitFor() == 0;
        } catch (Exception e) {
            return false;
        }
    }

    private static Runner dockerRunner(Path tmp, Duration timeout) {
        assumeTrue(dockerUp(), "docker недоступен");
        var d = Runner.Config.defaults();
        return new Runner(new Runner.Config(tmp, d.image(), d.memory(), d.cpus(), timeout));
    }

    @Test
    void demoSampleMatchesExpectedOutput(@TempDir Path tmp) throws Exception {
        Path demo = Path.of("../../samples/demo").toAbsolutePath().normalize();
        assumeTrue(Files.isDirectory(demo), "samples/demo не найден");
        Runner runner = dockerRunner(tmp, Duration.ofSeconds(60)); // первый запуск может тянуть образ
        Map<String, String> sources = new HashMap<>();
        try (var s = Files.walk(demo.resolve("src"))) {
            for (Path p : s.filter(f -> f.toString().endsWith(".java")).toList()) {
                sources.put(demo.resolve("src").relativize(p).toString().replace('\\', '/'), Files.readString(p));
            }
        }
        var r = runner.run(sources, null, Files.readString(demo.resolve("tests/basic.in")), Runner.Rewrite.RUN);
        assertTrue(r.compiled(), r.diagnostics().toString());
        assertEquals(0, r.exitCode(), r.stderr());
        // autocrlf на Windows даёт CRLF в эталоне
        assertEquals(Files.readString(demo.resolve("tests/basic.out")).replace("\r\n", "\n").strip(),
                r.stdout().replace("\r\n", "\n").strip());
    }

    @Test
    void timeoutKillsContainer(@TempDir Path tmp) {
        Runner runner = dockerRunner(tmp, Duration.ofSeconds(3));
        var r = runner.run(Map.of("Loop.java", "public class Loop { public static void main(String[] a) { while (true) {} } }"),
                null, "", Runner.Rewrite.NONE);
        assertTrue(r.timedOut());
    }
}
