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

class ReferenceEqualityTest {
    private static final Detector D = new ReferenceEquality();

    @Test
    void stringsAndWrappersComparedByReference() {
        ProjectAnalysis p = analyze("""
                class A {
                    private String name;
                    boolean f(String s, Integer a, Integer b, Long x, Long y, Boolean flag, Boolean other) {
                        boolean r = s == "admin";
                        r |= a != b;
                        r |= this.name == s;
                        r |= ("pre" + s) == name;
                        r |= x.equals(y) || x == y;
                        var t = make();
                        r |= t == s;
                        r |= flag == other;
                        return r;
                    }
                    String make() { return ""; }
                }
                """);
        List<Issue> f = D.detect(m(p, "p.A.f~0"), p);
        assertEquals(7, f.size());
        Issue i = f.get(0);
        assertEquals("ReferenceEquality", i.rule());
        assertEquals("high", i.severity());
        assertEquals("high", i.confidence());
        assertEquals(new Span("src/p/F0.java", 6, 6), i.span());
        assertTrue(i.message().startsWith("Сравнение ссылок s == \"admin\" для String"), i.message());
        assertTrue(i.recommendation().endsWith("стало: Objects.equals(s, \"admin\")"), i.recommendation());
        assertNull(i.complexity());
        assertTrue(i.fixes().isEmpty());
        assertTrue(f.get(1).recommendation().endsWith("стало: !Objects.equals(a, b)"), f.get(1).recommendation());
        assertTrue(f.get(1).message().contains("для Integer"), f.get(1).message());
        assertEquals("low", f.get(5).confidence(), "var от вызова метода — тип выведен неуверенно");
        assertEquals("high", f.get(6).confidence());
    }

    @Test
    void nullPrimitivesEnumsUnknownThisAreSilent() {
        ProjectAnalysis p = analyze("""
                class A {
                    enum Color { RED }
                    boolean f(String s, Integer a, int n, Color c, Object o, Character ch) {
                        boolean r = s == null || null != a;
                        r |= a == 5 || a == n || n == 3;
                        r |= c == Color.RED;
                        r |= o == s;
                        r |= this == o;
                        r |= ch == 'x';
                        r |= "a" == "a";
                        var u = unknown();
                        r |= u == s;
                        r |= s.equals("x");
                        return r;
                    }
                }
                """);
        assertTrue(D.detect(m(p, "p.A.f~0"), p).isEmpty());
    }

    @Test
    void untypedLambdaParamsAndRedeclaredNamesAreUnknown() {
        ProjectAnalysis p = analyze("""
                import java.util.stream.IntStream;
                class A {
                    private Integer x;
                    long f(int n, Integer limit, boolean c) {
                        long r = IntStream.range(0, n).filter(x -> x == limit).count();
                        if (c) { Integer v = 1; r += v == limit ? 1 : 0; } else { int v = 2; r += v == limit ? 1 : 0; }
                        return r;
                    }
                }
                """);
        assertTrue(D.detect(m(p, "p.A.f~0"), p).isEmpty());
    }

    @Test
    void varShadowingFieldIsUnknown() {
        ProjectAnalysis p = analyze("""
                class A {
                    private Integer count;
                    boolean f(List<String> items, Integer limit) {
                        var count = items.size();
                        if (count == limit) return true;
                        return false;
                    }
                }
                """);
        assertTrue(D.detect(m(p, "p.A.f~0"), p).isEmpty());
    }

    @Test
    void registeredAndSilentOnDemo() throws IOException {
        assertTrue(DetectorRegistry.defaults().detectors().stream().anyMatch(d -> d instanceof ReferenceEquality));
        ProjectAnalysis demo = ProjectAnalysis.of(ProjectAnalysisTest.demoFiles());
        assertTrue(DetectorRegistry.defaults().run(demo).stream().noneMatch(i -> i.rule().equals("ReferenceEquality")));
    }
}
