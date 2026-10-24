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

class EmptyCatchTest {
    private static final Detector D = new EmptyCatch();

    @Test
    void emptyBodyIsHighCommentIsLow() {
        ProjectAnalysis p = analyze("""
                class A {
                    void f() {
                        try { g(); } catch (IllegalStateException e) {
                        }
                        try { g(); } catch (RuntimeException | Error e) {
                            // намеренно: g() необязателен
                        }
                        try { g(); } catch (Exception e) { /* ignore */ }
                    }
                    void g() {}
                }
                """);
        List<Issue> f = D.detect(m(p, "p.A.f~0"), p);
        assertEquals(3, f.size());
        Issue i = f.get(0);
        assertEquals("EmptyCatch", i.rule());
        assertEquals("medium", i.severity());
        assertEquals("high", i.confidence());
        assertEquals(new Span("src/p/F0.java", 5, 6), i.span(), "span — catch-клауза");
        assertEquals("Исключение IllegalStateException перехватывается и молча игнорируется", i.message());
        assertTrue(i.recommendation().startsWith("Залогировать"), i.recommendation());
        assertTrue(i.recommendation().contains("throw new IllegalStateException(e)"), i.recommendation());
        assertNull(i.complexity());
        assertTrue(i.fixes().isEmpty());
        assertEquals("low", f.get(1).confidence(), "только комментарий — возможно, намеренно");
        assertTrue(f.get(1).message().startsWith("Исключение RuntimeException | Error "), f.get(1).message());
        assertEquals("low", f.get(2).confidence(), "блочный комментарий");
    }

    @Test
    void anyStatementIsNotEmpty() {
        ProjectAnalysis p = analyze("""
                class A {
                    int f() {
                        try { g(); } catch (Exception e) { throw new IllegalStateException(e); }
                        try { g(); } catch (Exception e) { return -1; }
                        try { g(); } catch (Exception e) { ; }
                        try { g(); } finally { }
                        Runnable r = () -> { try { g(); } catch (Exception e) { System.out.println(e); } };
                        return 0;
                    }
                    void g() {}
                }
                """);
        assertTrue(D.detect(m(p, "p.A.f~0"), p).isEmpty());
    }

    @Test
    void lambdaAndNestedClassEachReportedOnce() {
        ProjectAnalysis p = analyze("""
                class A {
                    void f() {
                        Runnable r = () -> { try { g(); } catch (Exception e) {} };
                    }
                    void g() {}
                    static class B {
                        void h() { try { new A().g(); } catch (Exception e) {} }
                    }
                }
                """);
        List<Issue> all = new DetectorRegistry(List.of(D)).run(p);
        assertEquals(2, all.size());
        assertEquals("p.A.f~0", all.get(0).methodId());
        assertTrue(all.get(1).methodId().endsWith("B.h~0"), all.get(1).methodId());
    }

    @Test
    void registeredAndSilentOnDemo() throws IOException {
        assertTrue(DetectorRegistry.defaults().detectors().stream().anyMatch(d -> d instanceof EmptyCatch));
        ProjectAnalysis demo = ProjectAnalysis.of(ProjectAnalysisTest.demoFiles());
        assertTrue(DetectorRegistry.defaults().run(demo).stream().noneMatch(i -> i.rule().equals("EmptyCatch")));
    }
}
