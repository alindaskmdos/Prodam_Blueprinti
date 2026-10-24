package blueprints.cli;

import static org.junit.jupiter.api.Assertions.*;

import blueprints.analysis.BigO;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import picocli.CommandLine;

class CliTest {
    static final String DEMO = Path.of("../../samples/demo").toString();

    record Run(int code, String out, String err) {}

    static Run run(String... args) {
        StringWriter out = new StringWriter(), err = new StringWriter();
        return run(Cli.commandLine(), out, err, args);
    }

    static Run run(CommandLine cl, StringWriter out, StringWriter err, String... args) {
        int code = cl.setOut(new PrintWriter(out)).setErr(new PrintWriter(err)).execute(args);
        return new Run(code, out.toString(), err.toString());
    }

    @CommandLine.Command(name = "boom")
    static final class Boom implements java.util.concurrent.Callable<Integer> {
        @CommandLine.Parameters
        String kind;

        @Override
        public Integer call() throws Exception {
            if (kind.equals("io")) throw new java.io.IOException("диск");
            throw new IllegalStateException("баг");
        }
    }

    @Test
    void exceptionsAreNotViolations() {
        for (var c : java.util.Map.of("io", Cli.LOAD_ERROR, "bug", Cli.INTERNAL_ERROR).entrySet()) {
            CommandLine cl = Cli.commandLine();
            cl.addSubcommand("boom", new Boom());
            Run r = run(cl, new StringWriter(), new StringWriter(), "boom", c.getKey());
            assertEquals(c.getValue(), r.code(), r.err());
            assertTrue(r.err().startsWith("ошибка: "), r.err());
        }
    }

    @Test
    void analyzeText() {
        Run r = run("analyze", DEMO);
        assertEquals(Cli.OK, r.code(), r.err());
        assertTrue(r.out().contains("src/com/demo/service/OrderService.java:44  high/high  NestedLoopSameCollection"), r.out());
        assertTrue(r.out().contains("Методов: 109, проблем: 24"), r.out());
    }

    @Test
    void analyzeJson() throws Exception {
        Run r = run("analyze", DEMO, "--format", "json");
        assertEquals(Cli.OK, r.code(), r.err());
        JsonNode j = new ObjectMapper().readTree(r.out());
        assertEquals(10_000, j.get("n").asInt());
        assertEquals(24, j.get("issues").size()); // +CatchBug в Main.handle (BE-51), +LongMethod Main.dispatch (BE-54), +LongLine fullReport (BE-55)
        JsonNode merge = null;
        for (JsonNode i : j.get("issues")) if (i.get("rule").asText().equals("NestedLoopSameCollection")) merge = i;
        assertNotNull(merge);
        assertEquals("com.demo.service.OrderService.merge~0", merge.get("methodId").asText());
        assertEquals("O(n²)", merge.get("complexity").get("before").asText());
        assertEquals(44, merge.get("span").get("startLine").asInt());
        assertEquals(109, j.get("metrics").size());
        assertTrue(j.get("metrics").get(0).has("maxNesting"));
    }

    @Test
    void failOnTriggers() {
        Run r = run("analyze", DEMO, "--fail-on", "O(n^2)");
        assertEquals(Cli.VIOLATION, r.code());
        assertTrue(r.err().contains("com.demo.service.InventoryService.distinctIds~0  O(n²)"), r.err());
        // JSON на stdout остаётся чистым, нарушения — в stderr
        Run j = run("analyze", DEMO, "--fail-on", "O(n²)", "--format", "json");
        assertEquals(Cli.VIOLATION, j.code());
        assertTrue(j.out().trim().startsWith("{") && j.out().trim().endsWith("}"));
    }

    @Test
    void failOnPasses() {
        assertEquals(Cli.OK, run("analyze", DEMO, "--fail-on", "O(n^20)").code());
    }

    @Test
    void badArgsArePicocliUsageErrors() {
        assertEquals(2, run("analyze", DEMO, "--fail-on", "O(n+m)").code());
        assertEquals(2, run("analyze", DEMO, "--format", "xml").code());
        assertEquals(2, run("analyze").code());
        assertEquals(2, run("frobnicate").code());
        assertEquals(2, run().code());
    }

    @Test
    void loadErrors(@TempDir Path dir) throws Exception {
        assertEquals(Cli.LOAD_ERROR, run("analyze", dir.resolve("nope").toString()).code());
        assertEquals(Cli.LOAD_ERROR, run("analyze", dir.toString()).code()); // нет .java
        Files.writeString(dir.resolve("A.java"), "class A { void f( }");
        assertEquals(Cli.LOAD_ERROR, run("analyze", dir.toString()).code());
    }

    @Test
    void rank() {
        assertEquals(new Rank(2, 0), Rank.parse("O(n^2)"));
        assertEquals(new Rank(2, 0), Rank.parse("O(n²)"));
        assertEquals(new Rank(2, 0), Rank.parse("o(n * m)"));
        assertEquals(new Rank(1, 1), Rank.parse("O(n log n)"));
        assertEquals(new Rank(0, 1), Rank.parse("O(log n)"));
        assertEquals(new Rank(0, 0), Rank.parse("O(1)"));
        assertThrows(IllegalArgumentException.class, () -> Rank.parse("n^2"));
        assertThrows(IllegalArgumentException.class, () -> Rank.parse("O()"));
        // старшее слагаемое, все символы = n: n·m ~ n², n log n < n²
        assertEquals(new Rank(2, 0), Rank.of(BigO.of("a").times(BigO.of("b")).plus(BigO.of("c"))));
        assertTrue(Rank.of(BigO.of("a").times(BigO.log("a"))).compareTo(Rank.parse("O(n^2)")) < 0);
        assertTrue(Rank.of(BigO.of("a").times(BigO.log("a"))).compareTo(Rank.parse("O(n)")) > 0);
    }
}
