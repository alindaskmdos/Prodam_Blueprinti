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

    // --- пакетный запуск ---

    @Test
    void runAllCompileErrorSkipsDocker(@TempDir Path tmp) {
        var rs = new Runner(new Runner.Config(tmp, "x", "64m", "1", Duration.ofSeconds(1)))
                .runAll(Map.of("Bad.java", "class Bad { int x = \"s\"; }"), "Bad", List.of("a", "b"), Runner.Rewrite.NONE);
        assertEquals(2, rs.size());
        assertTrue(rs.stream().noneMatch(Runner.RunResult::compiled));
    }

    @Test
    void runAllEmptyAndValidation(@TempDir Path tmp) {
        var r = new Runner(new Runner.Config(tmp, "x", "64m", "1", Duration.ofSeconds(1)));
        assertEquals(List.of(), r.runAll(Map.of("A.java", "class A {}"), "A", List.of(), Runner.Rewrite.NONE));
        assertThrows(IllegalArgumentException.class, () -> r.runAll(Map.of(), "A;rm", List.of(""), Runner.Rewrite.NONE));
    }

    /** Все запуски пакета видят один и тот же контейнер (hostname = id контейнера), разные пакеты — разные. */
    @Test
    void runAllUsesOneContainerPerBatch(@TempDir Path tmp) {
        Runner runner = dockerRunner(tmp, Duration.ofSeconds(60));
        Map<String, String> src = Map.of("Host.java", """
                public class Host {
                    public static void main(String[] a) throws Exception {
                        String in = new String(System.in.readAllBytes()).trim();
                        System.out.println(in + " " + java.nio.file.Files.readString(java.nio.file.Path.of("/etc/hostname")).trim());
                        if (in.equals("fail")) System.exit(5);
                    }
                }
                """);
        var rs = runner.runAll(src, null, List.of("a", "fail", "c"), Runner.Rewrite.RUN);
        assertEquals(3, rs.size());
        assertEquals(List.of(0, 5, 0), rs.stream().map(Runner.RunResult::exitCode).toList(), rs.toString());
        List<String> hosts = rs.stream().map(r -> r.stdout().trim().split(" ")[1]).distinct().toList();
        assertEquals(1, hosts.size(), "ожидался один контейнер: " + hosts);
        assertTrue(rs.get(0).stdout().startsWith("a "));
        assertTrue(rs.get(2).stdout().startsWith("c "));
        var again = runner.runAll(src, null, List.of("x"), Runner.Rewrite.RUN);
        assertNotEquals(hosts.get(0), again.get(0).stdout().trim().split(" ")[1]);
    }

    @Test
    void runAllTimeoutIsPerRun(@TempDir Path tmp) {
        Runner runner = dockerRunner(tmp, Duration.ofSeconds(3));
        Map<String, String> src = Map.of("Maybe.java", """
                public class Maybe {
                    public static void main(String[] a) throws Exception {
                        String in = new String(System.in.readAllBytes()).trim();
                        if (in.equals("loop")) while (true) {}
                        System.out.print(in);
                    }
                }
                """);
        var rs = runner.runAll(src, null, List.of("loop", "ok"), Runner.Rewrite.NONE);
        assertTrue(rs.get(0).timedOut());
        assertFalse(rs.get(1).timedOut(), rs.get(1).toString());
        assertEquals("ok", rs.get(1).stdout());
        assertEquals(0, rs.get(1).exitCode());
    }

    /** Обе программы пакета (текущая и оригинал) запускаются в одном контейнере. */
    @Test
    void runBatchRunsAllProgramsInOneContainer(@TempDir Path tmp) {
        Runner runner = dockerRunner(tmp, Duration.ofSeconds(60));
        String host = "System.out.print(%s + new String(System.in.readAllBytes()).trim() + \" \" "
                + "+ java.nio.file.Files.readString(java.nio.file.Path.of(\"/etc/hostname\")).trim());";
        var cur = new Runner.Program(Map.of("src/Main.java",
                "public class Main { public static void main(String[] a) throws Exception { " + host.formatted("\"cur:\"") + " } }"), null);
        var orig = new Runner.Program(Map.of("src/Main.java",
                "public class Main { public static void main(String[] a) throws Exception { " + host.formatted("\"orig:\"") + " } }"), "Main");
        var jobs = List.of(new Runner.Job(0, "1"), new Runner.Job(0, "2"), new Runner.Job(1, "1"), new Runner.Job(1, "2"), new Runner.Job(1, "1"));
        var rs = runner.runBatch(List.of(cur, orig), jobs, Runner.Rewrite.RUN);
        assertEquals(List.of("cur:1", "cur:2", "orig:1", "orig:2", "orig:1"),
                rs.stream().map(r -> r.stdout().split(" ")[0]).toList(), rs.toString());
        assertEquals(1, rs.stream().map(r -> r.stdout().split(" ")[1]).distinct().count(), "ожидался один контейнер: " + rs);
    }

    @Test
    void runBatchCompileErrorOnlyAffectsItsProgram(@TempDir Path tmp) {
        var r = new Runner(new Runner.Config(tmp, "x", "64m", "1", Duration.ofSeconds(1)));
        var bad = new Runner.Program(Map.of("Bad.java", "class Bad { int x = \"s\"; }"), "Bad");
        var rs = r.runBatch(List.of(bad, bad), List.of(new Runner.Job(0, ""), new Runner.Job(1, "")), Runner.Rewrite.NONE);
        assertTrue(rs.stream().noneMatch(Runner.RunResult::compiled));
        assertThrows(IllegalArgumentException.class,
                () -> r.runBatch(List.of(bad), List.of(new Runner.Job(1, "")), Runner.Rewrite.NONE));
    }

    // --- отказы песочницы на поддельном docker (без настоящего Docker) ---

    private static Path fakeDocker(Path dir) throws Exception {
        assumeTrue(Files.isExecutable(Path.of("/bin/bash")), "нужен bash");
        Path script = dir.resolve("docker");
        Files.writeString(script, """
                #!/bin/bash
                D="$(dirname "$0")"
                echo "$*" >> "$D/log"
                case "$1" in
                  run) if [ -f "$D/hang-start" ]; then sleep 30; fi; echo cid ;;
                  exec) in=$(cat); if [ "$in" = hang ]; then sleep 30; fi; printf '%s' "$in" ;;
                esac
                exit 0
                """);
        script.toFile().setExecutable(true);
        return script;
    }

    private static final Map<String, String> ECHO = Map.of("Echo.java", "public class Echo { public static void main(String[] a) {} }");

    @Test
    void hungExecAbortsRestWithoutClaimingTimeout(@TempDir Path tmp) throws Exception {
        Path docker = fakeDocker(tmp);
        var r = new Runner(new Runner.Config(tmp.resolve("work"), "img", "64m", "1", Duration.ofSeconds(1)),
                docker.toString(), 5_000, 500);
        var rs = r.runAll(ECHO, null, List.of("a", "hang", "c"), Runner.Rewrite.NONE);
        assertEquals("a", rs.get(0).stdout());
        assertFalse(rs.get(0).aborted());
        for (var x : rs.subList(1, 3)) {
            assertTrue(x.aborted(), x.toString());
            assertFalse(x.timedOut(), "не выполненный запуск — не таймаут программы");
            assertEquals(Runner.SANDBOX_DEAD, x.stderr());
        }
        String log = Files.readString(tmp.resolve("log"));
        assertEquals(1, log.lines().filter(l -> l.startsWith("run -d")).count(), log);
        assertEquals(2, log.lines().filter(l -> l.startsWith("exec")).count(), "после зависания запуски не выполняются: " + log);
        assertTrue(log.lines().anyMatch(l -> l.startsWith("rm -f bp-batch-")), log);
    }

    @Test
    void containerStartTimeoutLeavesNoContainer(@TempDir Path tmp) throws Exception {
        Path docker = fakeDocker(tmp);
        Files.writeString(tmp.resolve("hang-start"), "");
        var r = new Runner(new Runner.Config(tmp.resolve("work"), "img", "64m", "1", Duration.ofSeconds(1)),
                docker.toString(), 1_000, 500);
        var ex = assertThrows(IllegalStateException.class, () -> r.runAll(ECHO, null, List.of("a"), Runner.Rewrite.NONE));
        assertTrue(ex.getMessage().contains("не запустился"), ex.getMessage());
        String name = Files.readString(tmp.resolve("log")).lines().filter(l -> l.startsWith("run -d")).findFirst().orElseThrow()
                .replaceAll(".*--name (\\S+).*", "$1");
        assertTrue(name.startsWith("bp-batch-"), name);
        // сразу rm -f, затем повторные rm -f в фоне — на случай, если демон создаст контейнер позже
        long deadline = System.currentTimeMillis() + 10_000;
        long removes = 0;
        while (System.currentTimeMillis() < deadline && removes < 2) {
            Thread.sleep(200);
            removes = Files.readString(tmp.resolve("log")).lines().filter(l -> l.equals("rm -f " + name)).count();
        }
        assertTrue(removes >= 2, "ожидались повторные docker rm -f " + name);
    }
}
