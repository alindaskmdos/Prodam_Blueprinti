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

class IgnoredResultTest {
    private static final Detector D = new IgnoredResult();

    @Test
    void discardedResultsOfImmutableTypes() {
        ProjectAnalysis p = analyze("""
                import java.math.BigDecimal;
                import java.time.LocalDate;
                class A {
                    private String name;
                    void f(String s, BigDecimal total, LocalDate d, java.math.BigInteger big) {
                        s.trim();
                        s.trim().toLowerCase();
                        total.add(BigDecimal.ONE);
                        d.plusDays(1);
                        big.shiftLeft(2);
                        this.name.strip();
                        "abc".toUpperCase();
                        new BigDecimal("1").setScale(2);
                    }
                }
                """);
        List<Issue> f = D.detect(m(p, "p.A.f~0"), p);
        assertEquals(8, f.size());
        Issue i = f.get(0);
        assertEquals("IgnoredResult", i.rule());
        assertEquals("high", i.severity());
        assertEquals("high", i.confidence());
        assertEquals(new Span("src/p/F0.java", 8, 8), i.span());
        assertEquals("Результат s.trim() не используется — String неизменяем, s не меняется", i.message());
        assertTrue(i.recommendation().endsWith("стало: s = s.trim();"), i.recommendation());
        assertNull(i.complexity());
        assertTrue(i.fixes().isEmpty());
        assertTrue(f.get(1).recommendation().endsWith("s = s.trim().toLowerCase();"), f.get(1).recommendation());
        assertTrue(f.get(2).message().contains("BigDecimal неизменяем, total не меняется"), f.get(2).message());
        assertTrue(f.get(3).message().contains("LocalDate"), f.get(3).message());
        assertTrue(f.get(4).message().contains("BigInteger"), f.get(4).message());
        assertTrue(f.get(5).recommendation().endsWith("this.name = this.name.strip();"), f.get(5).recommendation());
        assertTrue(f.get(6).message().endsWith("вызов ничего не делает"), f.get(6).message());
    }

    @Test
    void usedResultsMutableAndUnknownTypesAreSilent() {
        ProjectAnalysis p = analyze("""
                import java.util.*;
                class A {
                    String f(String s, StringBuilder sb, List<String> list, Object o, Text t) {
                        s = s.trim();
                        String u = s.toUpperCase();
                        use(s.replace("a", "b"));
                        sb.append("x").reverse();
                        list.add(s);
                        s.length();
                        s.isEmpty();
                        o.toString();
                        t.trim();
                        unknown.trim();
                        var v = make();
                        v.trim();
                        String.valueOf(1);
                        return s.strip();
                    }
                    void use(String x) {}
                    String make() { return ""; }
                    static class Text { Text trim() { return this; } }
                }
                """);
        assertTrue(D.detect(m(p, "p.A.f~0"), p).isEmpty());
    }

    @Test
    void valueContextsAndAmbiguousNamesAreSilent() {
        ProjectAnalysis p = analyze("""
                import java.math.BigDecimal;
                class A {
                    private String name;
                    List<String> f(List<String> names, List<BigDecimal> xs, String s, int k) {
                        names.stream().map((String t) -> t.trim()).toList();
                        xs.stream().reduce(BigDecimal.ZERO, (BigDecimal a, BigDecimal b) -> a.add(b));
                        String r = switch (k) { case 1 -> s.trim(); default -> s; };
                        names.replaceAll(name -> name.trim());
                        return names;
                    }
                    void g(String s, int k) {
                        switch (k) { case 1 -> s.trim(); default -> {} }
                    }
                }
                """, """
                class Period { Period plusDays(int d) { return this; } }
                """, """
                class B {
                    void h(Period p) { p.plusDays(1); }
                }
                """);
        assertTrue(D.detect(m(p, "p.A.f~0"), p).isEmpty());
        assertEquals(1, D.detect(m(p, "p.A.g~0"), p).size(), "switch-оператор — по-прежнему находка");
        assertTrue(D.detect(m(p, "p.B.h~0"), p).isEmpty(), "свой класс Period проекта");
    }

    @Test
    void registeredAndSilentOnDemo() throws IOException {
        assertTrue(DetectorRegistry.defaults().detectors().stream().anyMatch(d -> d instanceof IgnoredResult));
        ProjectAnalysis demo = ProjectAnalysis.of(ProjectAnalysisTest.demoFiles());
        assertTrue(DetectorRegistry.defaults().run(demo).stream().noneMatch(i -> i.rule().equals("IgnoredResult")));
    }
}
