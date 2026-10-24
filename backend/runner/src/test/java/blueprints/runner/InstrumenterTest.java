package blueprints.runner;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class InstrumenterTest {

    private static final Path ROUNDTRIP = Path.of("../../samples/roundtrip").toAbsolutePath().normalize();
    private static final Path DEMO = Path.of("../../samples/demo").toAbsolutePath().normalize();

    private static String h(int i) {
        return "__blueprints.Trace.hit(" + i + "); ";
    }

    private static Instrumenter.Result one(String code) {
        return Instrumenter.instrument(Map.of("A.java", code));
    }

    private static String code(String code) {
        return one(code).sources().get("A.java");
    }

    @Test
    void methodAndStatements() {
        assertEquals("class A { void f() {" + h(0) + " " + h(1) + "int x = 1; " + h(2) + "x++; } }",
                code("class A { void f() { int x = 1; x++; } }"));
    }

    @Test
    void constructorHitGoesAfterSuperOrThis() {
        assertEquals("class A extends B { A() { super(1);" + h(0) + h(1) + " " + h(2) + "f(); } A(int x) { this();" + h(3) + h(4) + " } }",
                code("class A extends B { A() { super(1); f(); } A(int x) { this(); } }"));
        var p = one("class A { A() { this(1); } A(int x) {} }").probes();
        assertEquals(List.of("A.<init>~0", "A.<init>~0", "A.<init>~1"), p.stream().map(Instrumenter.Probe::methodId).toList());
        assertEquals(List.of("", "body/0", ""), p.stream().map(Instrumenter.Probe::path).toList());
    }

    @Test
    void singleStatementBodiesAreWrapped() {
        assertEquals("class A { void f(boolean b) {" + h(0) + " " + h(1) + "if (b) { " + h(2) + "g(); } else { " + h(3)
                        + "if (!b) { " + h(4) + "g(); } } " + h(5) + "while (b) { " + h(6) + "b = false; } " + h(7)
                        + "for (;;) { " + h(8) + "break; } } }",
                code("class A { void f(boolean b) { if (b) g(); else if (!b) g(); while (b) b = false; for (;;) break; } }"));
        var p = one("class A { void f(boolean b) { if (b) g(); else { g(); h(); } } }").probes();
        assertEquals(List.of("", "body/0", "body/0/then/0", "body/0/else/0", "body/0/else/1"),
                p.stream().map(Instrumenter.Probe::path).toList());
    }

    @Test
    void switchCases() {
        String src = "class A { void f(int x) { switch (x) { case 1: case 2: g(); break; default: } "
                + "switch (x) { case 1 -> g(); case 2 -> { g(); } default -> throw new RuntimeException(); } } }";
        assertEquals("class A { void f(int x) {" + h(0) + " " + h(1) + "switch (x) { case 1:" + h(2) + " case 2: " + h(3) + h(4)
                        + "g(); " + h(5) + "break; default:" + h(6) + " } " + h(7) + "switch (x) { case 1 -> { " + h(8) + h(9)
                        + "g(); } case 2 -> {" + h(10) + " " + h(11) + "g(); } default -> { " + h(12) + h(13)
                        + "throw new RuntimeException(); } } } }",
                code(src));
        var p = one(src).probes();
        assertEquals(List.of("", "body/0", "body/0/cases/0", "body/0/cases/1", "body/0/cases/1/body/0", "body/0/cases/1/body/1",
                        "body/0/cases/2", "body/1", "body/1/cases/0", "body/1/cases/0/body/0", "body/1/cases/1",
                        "body/1/cases/1/body/0", "body/1/cases/2", "body/1/cases/2/body/0"),
                p.stream().map(Instrumenter.Probe::path).toList());
    }

    @Test
    void tryCatchFinally() {
        assertEquals("class A { void f() {" + h(0) + " " + h(1) + "try { " + h(2) + "g(); } catch (Exception e) {" + h(3) + " "
                        + h(4) + "h(); } finally { " + h(5) + "k(); } } }",
                code("class A { void f() { try { g(); } catch (Exception e) { h(); } finally { k(); } } }"));
        assertEquals(List.of("", "body/0", "body/0/body/0", "body/0/catches/0", "body/0/catches/0/body/0", "body/0/finally/0"),
                one("class A { void f() { try { g(); } catch (Exception e) { h(); } finally { k(); } } }").probes()
                        .stream().map(Instrumenter.Probe::path).toList());
    }

    /** Лямбды, анонимные и локальные классы, switch-выражения, метки, вложенный {} — текст ноды, внутрь не заходим. */
    @Test
    void expressionsAndRawAreUntouched() {
        String body = "Runnable r = () -> { g(); }; Object o = new Object() { void m() { g(); } }; "
                + "int y = switch (1) { case 1 -> 2; default -> { yield 3; } }; class L { void m() { g(); } } "
                + "out: for (;;) { break out; } { g(); } synchronized (this) { g(); }";
        String out = code("class A { void f() { " + body + " } }");
        assertEquals(8, out.split("Trace\\.hit").length - 1, out); // метод + 7 операторов
        assertTrue(out.contains("out: for (;;) { break out; }"), out);
    }

    @Test
    void typesAndIdsLikeTreeBuilder() {
        var p = one("package p; interface I { default void d() { } void abs(); } "
                + "enum E { X { void m() { } }; E() { } void m() { } void m(int a) { } } "
                + "record R(int a) { R { } int b() { return a; } class In { void q() { } } }").probes();
        assertEquals(List.of("p.I.d~0", "p.E.<init>~0", "p.E.m~0", "p.E.m~1", "p.R.b~0", "p.R.b~0", "p.R$In.q~0"),
                p.stream().map(Instrumenter.Probe::methodId).toList());
    }

    @Test
    void linesAndPositionsKept() {
        String src = "class A {\r\n\tvoid f() {\r\n\t\tif (true)\r\n\t\t\tg();\r\n\t}\r\n}\r\n";
        var r = one(src);
        assertEquals(src.lines().count(), r.sources().get("A.java").lines().count());
        var p = r.probes();
        assertEquals(List.of(2, 3, 4), p.stream().map(Instrumenter.Probe::line).toList());
        assertEquals(List.of(2, 3, 4), p.stream().map(Instrumenter.Probe::column).toList());
        assertNotEquals(src, r.sources().get("A.java"));
        // файл, который JavaParser не разбирает, остаётся как есть
        String unparsed = "class B { void f() { enum X { Y } } }";
        assertEquals(unparsed, Instrumenter.instrument(Map.of("B.java", unparsed)).sources().get("B.java"));
    }

    @Test
    void traceSourceAndHits() {
        var r = one("class A { void f() { } }");
        assertTrue(r.sources().get("__blueprints/Trace.java").contains("new long[1]"));
        assertArrayEquals(new long[] {5, 0, 7}, Instrumenter.parseHits("0 5\n2 7\n9 1\n", 3));
    }

    // --- корпус ---

    private static Map<String, String> javaFiles(Path dir) throws Exception {
        Map<String, String> m = new LinkedHashMap<>();
        try (var s = Files.walk(dir)) {
            for (Path p : s.filter(f -> f.toString().endsWith(".java")).sorted().toList()) {
                m.put(dir.relativize(p).toString().replace('\\', '/'), Files.readString(p));
            }
        }
        return m;
    }

    private static List<Path> roundtripFiles() throws Exception {
        assumeTrue(Files.isDirectory(ROUNDTRIP), "samples/roundtrip не найден");
        try (var s = Files.list(ROUNDTRIP)) {
            return s.filter(f -> f.toString().endsWith(".java")).sorted().toList();
        }
    }

    private static void write(Map<String, String> sources, Path dir) throws Exception {
        for (var e : sources.entrySet()) {
            Path p = dir.resolve(e.getKey());
            Files.createDirectories(p.getParent());
            Files.writeString(p, e.getValue());
        }
    }

    /** §14а.6: каждый файл корпуса после инструментации компилируется, у каждого метода есть нода. */
    @Test
    void corpusCompilesAfterInstrumentation(@TempDir Path tmp) throws Exception {
        List<Map<String, String>> programs = new ArrayList<>();
        for (Path f : roundtripFiles()) programs.add(Map.of(f.getFileName().toString(), Files.readString(f)));
        if (Files.isDirectory(DEMO)) programs.add(javaFiles(DEMO.resolve("src")));
        int k = 0;
        for (var src : programs) {
            var r = Instrumenter.instrument(src);
            // NestedClasses (локальные enum/interface) JavaParser не разбирает — остаётся без вставок
            assertEquals(src.containsKey("NestedClasses.java"), r.probes().isEmpty(), src.keySet().toString());
            Path dir = tmp.resolve("p" + k++);
            write(r.sources(), dir.resolve("src"));
            assertEquals(List.of(), Runner.compile(dir.resolve("src"), dir.resolve("out")), src.keySet().toString());
        }
    }

    // --- Docker: вывод с инструментацией и без совпадает ---

    private static boolean dockerUp() {
        try {
            Process p = new ProcessBuilder("docker", "info").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            return p.waitFor() == 0;
        } catch (Exception e) {
            return false;
        }
    }

    private static Runner dockerRunner(Path tmp) {
        assumeTrue(dockerUp(), "docker недоступен");
        var d = Runner.Config.defaults();
        return new Runner(new Runner.Config(tmp, d.image(), d.memory(), d.cpus(), Duration.ofSeconds(20)));
    }

    /** Чистая программа (RUN) и инструментированная (TRACE) в одном пакете; jobs попарно: чистый, затем с Trace. */
    private static void assertSameBehavior(Runner runner, List<Map<String, String>> sources, List<String> mains,
                                           List<List<String>> stdins) {
        List<Runner.Program> programs = new ArrayList<>();
        List<Runner.Job> jobs = new ArrayList<>();
        for (int i = 0; i < sources.size(); i++) {
            programs.add(new Runner.Program(sources.get(i), mains.get(i), Runner.Rewrite.RUN, List.of()));
            programs.add(new Runner.Program(sources.get(i), mains.get(i), Runner.Rewrite.TRACE, List.of()));
            for (String in : stdins.get(i)) {
                jobs.add(new Runner.Job(2 * i, in));
                jobs.add(new Runner.Job(2 * i + 1, in));
            }
        }
        var rs = runner.runBatch(programs, jobs, Runner.Rewrite.RUN);
        for (int k = 0; k < jobs.size(); k += 2) {
            var clean = rs.get(k);
            var traced = rs.get(k + 1);
            String what = mains.get(jobs.get(k).program() / 2);
            assertTrue(clean.compiled() && traced.compiled(), what + " " + traced.diagnostics());
            assertFalse(clean.timedOut() || traced.timedOut(), what);
            assertEquals(clean.stdout(), traced.stdout(), what);
            assertEquals(clean.exitCode(), traced.exitCode(), what + " " + traced.stderr());
            assertNull(clean.hits(), what);
            if (Instrumenter.instrument(sources.get(jobs.get(k).program() / 2)).probes().isEmpty()) continue; // не разобран
            assertNotNull(traced.hits(), what + ": нет счётчиков");
            assertTrue(java.util.Arrays.stream(traced.hits()).anyMatch(x -> x > 0), what);
        }
    }

    @Test
    void corpusOutputSameWithTrace(@TempDir Path tmp) throws Exception {
        Runner runner = dockerRunner(tmp);
        List<Map<String, String>> sources = new ArrayList<>();
        List<String> mains = new ArrayList<>();
        List<List<String>> stdins = new ArrayList<>();
        for (Path f : roundtripFiles()) {
            String name = f.getFileName().toString().replace(".java", "");
            sources.add(Map.of(f.getFileName().toString(), Files.readString(f)));
            mains.add(name);
            Path in = ROUNDTRIP.resolve(name + ".in");
            stdins.add(List.of(Files.exists(in) ? Files.readString(in) : ""));
        }
        assertSameBehavior(runner, sources, mains, stdins);
    }

    @Test
    void demoOutputSameWithTrace(@TempDir Path tmp) throws Exception {
        assumeTrue(Files.isDirectory(DEMO), "samples/demo не найден");
        Runner runner = dockerRunner(tmp);
        List<String> ins = new ArrayList<>();
        try (var s = Files.list(DEMO.resolve("tests"))) {
            for (Path p : s.filter(f -> f.toString().endsWith(".in")).sorted().toList()) ins.add(Files.readString(p));
        }
        assertSameBehavior(runner, List.of(javaFiles(DEMO.resolve("src"))), List.of("com.demo.Main"), List.of(ins));
    }

    /** Счётчики — реальные числа выполнений, run() с TRACE тоже их отдаёт. */
    @Test
    void hitsCountExecutions(@TempDir Path tmp) {
        Runner runner = dockerRunner(tmp);
        var src = Map.of("Main.java", "public class Main { public static void main(String[] a) { "
                + "for (int i = 0; i < 5; i++) if (i % 2 == 0) System.out.print(i); System.exit(3); } }");
        var r = runner.run(src, null, "", Runner.Rewrite.TRACE);
        assertEquals("024", r.stdout());
        assertEquals(3, r.exitCode());
        // метод, for, if (×5), print (×3), exit
        assertArrayEquals(new long[] {1, 1, 5, 3, 1}, r.hits());
    }
}
