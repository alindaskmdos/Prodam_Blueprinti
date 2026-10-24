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

class CatchBugTest {
    private static final Detector D = new CatchBug();

    @Test
    void fatalIsHighProgrammerErrorIsMedium() {
        ProjectAnalysis p = analyze("""
                class A {
                    void f() {
                        try { g(); } catch (Throwable t) {
                            t.printStackTrace();
                        }
                        try { g(); } catch (NullPointerException e) { g(); }
                        try { g(); } catch (IllegalStateException | ArrayIndexOutOfBoundsException | ClassCastException e) { g(); }
                        try { g(); } catch (java.lang.Error | ArithmeticException e) { g(); }
                    }
                    void g() {}
                }
                """);
        List<Issue> f = D.detect(m(p, "p.A.f~0"), p);
        assertEquals(4, f.size());
        Issue i = f.get(0);
        assertEquals("CatchBug", i.rule());
        assertEquals("high", i.severity());
        assertEquals("high", i.confidence());
        assertEquals(new Span("src/p/F0.java", 5, 7), i.span(), "span — catch-клауза");
        assertTrue(i.message().startsWith("Перехват Throwable глотает фатальные ошибки"), i.message());
        assertNull(i.complexity());
        assertTrue(i.fixes().isEmpty());
        assertEquals("medium", f.get(1).severity());
        assertTrue(f.get(1).message().contains("NullPointerException"), f.get(1).message());
        assertEquals("medium", f.get(2).severity());
        assertTrue(f.get(2).message().contains("ArrayIndexOutOfBoundsException, ClassCastException"), f.get(2).message());
        assertTrue(!f.get(2).message().contains("IllegalState"), f.get(2).message());
        assertEquals("high", f.get(3).severity(), "Error в multi-catch — high, ArithmeticException тоже в message");
        assertTrue(f.get(3).message().contains("Error, ArithmeticException"), f.get(3).message());
    }

    @Test
    void ordinaryExceptionsAreSilent() {
        ProjectAnalysis p = analyze("""
                class A {
                    void f() {
                        try { g(); } catch (Exception e) { g(); }
                        try { g(); } catch (RuntimeException | java.io.UncheckedIOException e) { g(); }
                        try { g(); } catch (IllegalArgumentException e) { g(); }
                        try { g(); } catch (NumberFormatException e) { g(); }
                        try { g(); } catch (MyError e) { g(); }
                        try { g(); } catch (Throwable t) { cleanup(); throw t; }
                        try { g(); } catch (NullPointerException e) { throw new IllegalStateException("broken", e); }
                    }
                    void g() {}
                    void cleanup() {}
                    static class MyError extends RuntimeException {}
                }
                """);
        assertTrue(D.detect(m(p, "p.A.f~0"), p).isEmpty());
    }

    @Test
    void registeredAndOnDemoOnlyIndexOutOfBoundsInMainHandle() throws IOException {
        assertTrue(DetectorRegistry.defaults().detectors().stream().anyMatch(d -> d instanceof CatchBug));
        ProjectAnalysis demo = ProjectAnalysis.of(ProjectAnalysisTest.demoFiles());
        List<String> found = DetectorRegistry.defaults().run(demo).stream().filter(i -> i.rule().equals("CatchBug"))
                .map(i -> i.methodId() + ":" + i.span().startLine() + ":" + i.severity()).toList();
        assertEquals(List.of("com.demo.Main.handle~0:68:medium"), found);
    }
}
