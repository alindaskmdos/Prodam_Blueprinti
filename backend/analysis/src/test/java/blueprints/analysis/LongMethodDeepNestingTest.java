package blueprints.analysis;

import static blueprints.analysis.ProjectAnalysisTest.analyze;
import static blueprints.analysis.ProjectAnalysisTest.m;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
import blueprints.model.Span;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;

class LongMethodDeepNestingTest {
    private static final Detector LONG = new LongMethod();
    private static final Detector DEEP = new DeepNesting();

    @Test
    void linesAreDeclarationRange() {
        String body = "        int x = 0;\n\n        // c\n".repeat(10) + "        x++;\n"; // 31 строка тела
        ProjectAnalysis p = analyze("class A {\n    @Deprecated\n    void big() {\n" + body + "    }\n"
                + "    /** doc */\n    void ok() {\n" + "        x();\n".repeat(28) + "    }\n}\n");
        MethodAnalysis big = m(p, "p.A.big~0"), ok = m(p, "p.A.ok~0");
        assertEquals(34, big.lines(), "аннотация в счёт");
        assertEquals(30, ok.lines(), "javadoc не в счёт");
        List<Issue> f = LONG.detect(big, p);
        assertEquals(1, f.size());
        Issue i = f.get(0);
        assertEquals("LongMethod", i.rule());
        assertEquals("low", i.severity());
        assertEquals("high", i.confidence());
        assertEquals(new Span("src/p/F0.java", 4, 37), i.span());
        assertNull(i.complexity());
        assertTrue(i.fixes().isEmpty());
        assertTrue(i.message().contains("34"), i.message());
        assertTrue(i.recommendation().startsWith("Выделить метод"), i.recommendation());
        assertTrue(LONG.detect(ok, p).isEmpty(), "ровно порог — не длинный");
    }

    @Test
    void nestingCountsControlConstructs() {
        ProjectAnalysis p = analyze("""
                class A {
                    void flat() { int x = 1; }
                    void elseIf(int a) {
                        if (a == 1) {} else if (a == 2) {} else if (a == 3) {} else if (a == 4) { if (a > 0) {} }
                    }
                    void deep(List<Integer> xs) {
                        for (int x : xs) {
                            while (x > 0) {
                                if (x > 1) {
                                    try { x--; } catch (Exception e) { synchronized (this) { x = 0; } }
                                }
                                if (x > 5) {}
                            }
                        }
                    }
                    void lambda(List<Integer> xs) {
                        for (int x : xs) xs.forEach(y -> { if (y > 0) { switch (y) { default -> {} } } });
                    }
                    void anon() {
                        if (true) {
                            Runnable r = new Runnable() { public void run() { for (;;) { for (;;) { for (;;) { if (true) {} } } } } };
                        }
                    }
                    void local() {
                        class L { void g() { do { do { do { do {} while (true); } while (true); } while (true); } while (true); } }
                    }
                    void anonArg() {
                        new Thread(() -> { if (true) { if (true) {} } }) { public void run() { for (;;) { for (;;) { for (;;) {} } } } };
                    }
                }
                """);
        assertEquals(1, m(p, "p.A.flat~0").maxNesting(), "тело метода — уровень 1");
        assertNull(m(p, "p.A.flat~0").deepestConstruct());
        assertEquals(3, m(p, "p.A.elseIf~0").maxNesting(), "else-if не углубляет");
        MethodAnalysis deep = m(p, "p.A.deep~0");
        assertEquals(6, deep.maxNesting());
        assertEquals(12, deep.deepestConstruct().getBegin().get().line, "synchronized в catch");
        assertEquals(4, m(p, "p.A.lambda~0").maxNesting(), "лямбда прозрачна");
        assertEquals(2, m(p, "p.A.anon~0").maxNesting(), "тело анонимного класса не считается");
        assertEquals(1, m(p, "p.A.local~0").maxNesting(), "локальный класс не считается");
        assertEquals(3, m(p, "p.A.anonArg~0").maxNesting(), "аргумент конструктора анонимного класса считается, тело — нет");
    }

    @Test
    void deepNestingOneIssuePerMethod() {
        ProjectAnalysis p = analyze("""
                class A {
                    void f(List<Integer> xs) {
                        for (int x : xs) {
                            for (int y : xs) {
                                if (x > y) {
                                    if (x > 0) {}
                                    if (y > 0) {}
                                }
                            }
                        }
                    }
                    void g(List<Integer> xs) { for (int x : xs) for (int y : xs) if (x > y) {} }
                }
                """);
        List<Issue> f = DEEP.detect(m(p, "p.A.f~0"), p);
        assertEquals(1, f.size());
        Issue i = f.get(0);
        assertEquals("DeepNesting", i.rule());
        assertEquals("high", i.confidence());
        assertEquals(new Span("src/p/F0.java", 8, 8), i.span(), "первая из самых глубоких");
        assertTrue(i.message().contains("5 уровней"), i.message());
        assertTrue(i.fixes().isEmpty());
        assertTrue(DEEP.detect(m(p, "p.A.g~0"), p).isEmpty(), "ровно порог — не сообщается");
    }

    @Test
    void demoExactHits() throws IOException {
        ProjectAnalysis demo = ProjectAnalysis.of(ProjectAnalysisTest.demoFiles());
        List<String> hits = DetectorRegistry.defaults().run(demo).stream()
                .filter(i -> i.rule().equals("LongMethod") || i.rule().equals("DeepNesting"))
                .map(i -> i.rule() + " " + i.methodId() + " " + i.span().startLine() + "-" + i.span().endLine())
                .toList();
        assertEquals(List.of("LongMethod com.demo.Main.dispatch~0 74-123",
                "LongMethod com.demo.service.ReportService.fullReport~0 29-84",
                "DeepNesting com.demo.service.ReportService.hotProducts~0 97-99"), hits);
        assertEquals(56, demo.method("com.demo.service.ReportService.fullReport~0").lines());
        assertEquals(7, demo.method("com.demo.service.ReportService.hotProducts~0").maxNesting());
        assertEquals(19, demo.method("com.demo.service.OrderService.merge~0").lines(), "как в contract/fixtures/analysis.merge.json");
        assertEquals(4, demo.method("com.demo.service.OrderService.merge~0").maxNesting(), "как в contract/fixtures/analysis.merge.json");
        assertEquals(50, demo.method("com.demo.Main.dispatch~0").lines(), "диспетчер выше порога 30 (BE-53)");
    }
    // samples/roundtrip без падений — ProjectAnalysisTest.wholeSampleCorpusWithoutExceptions гоняет весь DetectorRegistry.defaults().
}
