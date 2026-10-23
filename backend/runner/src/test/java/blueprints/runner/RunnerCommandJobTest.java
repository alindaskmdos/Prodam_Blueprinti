package blueprints.runner;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Добавления BE-11: command-запуски, доп. файлы в контейнере, rewrite и classpath программы. */
class RunnerCommandJobTest {

    private static final Map<String, String> HOST = Map.of("src/Main.java",
            "public class Main { public static void main(String[] a) throws Exception { "
                    + "System.out.print(java.nio.file.Files.readString(java.nio.file.Path.of(\"/etc/hostname\")).trim()); } }");

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
    void mountTargetsAreValidated(@TempDir Path tmp) throws Exception {
        var r = new Runner(new Runner.Config(tmp, "x", "64m", "1", Duration.ofSeconds(1)));
        Path f = Files.writeString(tmp.resolve("f.txt"), "x");
        var p = List.of(new Runner.Program(HOST, null));
        var jobs = List.of(new Runner.Job(0, ""));
        for (String bad : List.of("rel/f", "/app/p0/f", "/app", "/opt/../etc/f", "/opt/a,readonly=false", "/opt/a b"))
            assertThrows(IllegalArgumentException.class, () -> r.runBatch(p, jobs, Runner.Rewrite.NONE, Map.of(bad, f)), bad);
        assertThrows(IllegalArgumentException.class,
                () -> r.runBatch(p, jobs, Runner.Rewrite.NONE, Map.of("/opt/f", tmp.resolve("missing"))));
    }

    /** Программа только с command-запусками не обязана иметь main; с обычным запуском — как раньше. */
    @Test
    void commandOnlyProgramNeedsNoMain(@TempDir Path tmp) {
        var r = new Runner(new Runner.Config(tmp, "x", "64m", "1", Duration.ofSeconds(1)));
        var noMain = new Runner.Program(Map.of("Bad.java", "class Bad { int x = \"s\"; }"), null);
        var rs = r.runBatch(List.of(noMain), List.of(new Runner.Job(0, "", List.of("true"))), Runner.Rewrite.NONE);
        assertFalse(rs.get(0).compiled(), "дошли до компиляции, main не искали");
        assertThrows(IllegalArgumentException.class,
                () -> r.runBatch(List.of(noMain), List.of(new Runner.Job(0, "")), Runner.Rewrite.NONE));
    }

    /** Rewrite программы важнее общего; classpath программы передаётся компилятору. */
    @Test
    void programRewriteAndClasspath(@TempDir Path tmp) throws Exception {
        var r = new Runner(new Runner.Config(tmp.resolve("w"), "x", "64m", "1", Duration.ofSeconds(1)));
        Path lib = tmp.resolve("lib");
        Files.createDirectories(lib.resolve("src/lib"));
        Files.writeString(lib.resolve("src/lib/L.java"), "package lib; public class L { public static int v() { return 1; } }");
        assertEquals(List.of(), Runner.compile(lib.resolve("src"), lib.resolve("out")));
        // единственная ошибка — нарочная (Z): private снят rewrite'ом программы (у пакета NONE), lib.L найден по classpath
        Map<String, String> code = Map.of("A.java", "class A { private int f() { return lib.L.v(); } }",
                "D.java", "class D { int h(A a) { return a.f(); } }", "Z.java", "class Z { int z = \"s\"; }");
        var withCp = new Runner.Program(code, null, Runner.Rewrite.JUNIT, List.of(lib.resolve("out")));
        var rs = r.runBatch(List.of(withCp), List.of(new Runner.Job(0, "", List.of("true"))), Runner.Rewrite.NONE);
        assertFalse(rs.get(0).compiled());
        assertEquals(1, rs.get(0).diagnostics().size(), rs.get(0).diagnostics().toString());
        assertTrue(rs.get(0).diagnostics().get(0).startsWith("Z.java"), rs.get(0).diagnostics().toString());
        var asBatch = new Runner.Program(code, null, null, List.of(lib.resolve("out")));
        var rs1 = r.runBatch(List.of(asBatch), List.of(new Runner.Job(0, "", List.of("true"))), Runner.Rewrite.NONE);
        assertTrue(rs1.get(0).diagnostics().stream().anyMatch(d -> d.startsWith("D.java")), rs1.get(0).diagnostics().toString());
        var noCp = new Runner.Program(Map.of("A.java", "class A { int f() { return lib.L.v(); } }"), null, null, List.of());
        var rs2 = r.runBatch(List.of(noCp), List.of(new Runner.Job(0, "", List.of("true"))), Runner.Rewrite.NONE);
        assertTrue(rs2.get(0).diagnostics().stream().anyMatch(d -> d.contains("lib")), rs2.get(0).diagnostics().toString());
    }

    /** command-запуск видит классы программы и read-only файл, выполняется в том же контейнере, что и java-запуски. */
    @Test
    void commandJobRunsInSameContainerWithMountedFile(@TempDir Path tmp) throws Exception {
        Runner runner = dockerRunner(tmp.resolve("w"), Duration.ofSeconds(10));
        Path f = Files.writeString(tmp.resolve("data.txt"), "hello");
        var prog = new Runner.Program(HOST, null);
        var cmd = new Runner.Job(0, "", List.of("sh", "-c",
                "cat /opt/bp/data.txt; echo; cat /etc/hostname; ls $0; echo x > /opt/bp/data.txt 2>/dev/null || echo ro",
                Runner.programDir(0)));
        var rs = runner.runBatch(List.of(prog), List.of(new Runner.Job(0, ""), cmd), Runner.Rewrite.RUN,
                Map.of("/opt/bp/data.txt", f));
        String host = rs.get(0).stdout();
        assertFalse(host.isBlank(), rs.toString());
        List<String> lines = rs.get(1).stdout().lines().toList();
        assertEquals(List.of("hello", host, "Main.class", "ro"), lines, rs.toString());
        assertEquals("hello", Files.readString(f));
    }

    @Test
    void defaultCommandTimeoutIsLonger() {
        var c = new Runner.Config(Path.of("/tmp"), "x", "64m", "1", Duration.ofSeconds(10));
        assertEquals(Duration.ofSeconds(30), c.commandTimeout());
        assertEquals(Duration.ofSeconds(30), Runner.Config.defaults().commandTimeout());
        assertEquals(Duration.ofSeconds(10), Runner.Config.defaults().timeout());
    }

    /** command-запуск — свой (больший) таймаут, java-запуски — обычный. */
    @Test
    void commandJobHasOwnTimeout(@TempDir Path tmp) {
        assumeTrue(dockerUp(), "docker недоступен");
        var d = Runner.Config.defaults();
        Runner runner = new Runner(new Runner.Config(tmp, d.image(), d.memory(), d.cpus(), Duration.ofSeconds(1), Duration.ofSeconds(4)));
        var prog = new Runner.Program(HOST, null);
        var rs = runner.runBatch(List.of(prog), List.of(
                        new Runner.Job(0, "", List.of("sh", "-c", "sleep 2; echo done")),
                        new Runner.Job(0, "", List.of("sleep", "30")), new Runner.Job(0, "")),
                Runner.Rewrite.RUN, Map.of());
        assertFalse(rs.get(0).timedOut(), "2 с < commandTimeout 4 с, хотя > timeout 1 с: " + rs);
        assertEquals("done\n", rs.get(0).stdout());
        rs = List.of(rs.get(1), rs.get(2));
        assertTrue(rs.get(0).timedOut(), rs.toString());
        assertTrue(rs.get(0).millis() >= 4000 && rs.get(0).millis() < 10_000, rs.toString());
        assertFalse(rs.get(0).aborted());
        assertFalse(rs.get(1).stdout().isBlank(), "после таймаута command-запуска пакет продолжается");
    }
}
