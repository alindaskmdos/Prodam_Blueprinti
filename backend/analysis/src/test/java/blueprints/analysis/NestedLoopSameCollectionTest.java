package blueprints.analysis;

import static blueprints.analysis.ProjectAnalysisTest.analyze;
import static blueprints.analysis.ProjectAnalysisTest.m;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;

class NestedLoopSameCollectionTest {
    private static final Detector D = new NestedLoopSameCollection();

    private static List<Issue> run(ProjectAnalysis p, String id) {
        return D.detect(m(p, id), p);
    }

    @Test
    void sameCollectionNested() {
        ProjectAnalysis p = analyze("""
                class A {
                    List<Integer> orders = new ArrayList<>();
                    int f() {
                        int s = 0;
                        for (int i = 0; i < orders.size(); i++)
                            for (int j = i + 1; j < orders.size(); j++)
                                s++;
                        return s;
                    }
                    int g(List<Integer> xs) { int s = 0; for (int x : xs) { for (int y : xs) { s++; } } return s; }
                    int viaParam(List<Integer> a) { return h(a, a); }
                    int h(List<Integer> a, List<Integer> b) { int s = 0; for (int x : a) for (int y : b) s++; return s; }
                    void w(List<Integer> xs) { int i = 0; while (i < xs.size()) { for (int y : xs) {} i++; } }
                }
                """);
        List<Issue> f = run(p, "p.A.f~0");
        assertEquals(1, f.size());
        Issue i = f.get(0);
        assertEquals("NestedLoopSameCollection", i.rule());
        assertEquals("high", i.confidence());
        assertEquals("p.A.f~0", i.methodId());
        assertEquals(new blueprints.model.Span("src/p/F0.java", 8, 9), i.span());
        assertEquals("O(n²)", i.complexity().before());
        assertEquals("O(n)", i.complexity().after());
        assertTrue(i.message().contains("orders"), i.message());
        assertTrue(i.fixes().isEmpty());

        assertEquals(1, run(p, "p.A.g~0").size());
        assertEquals("low", run(p, "p.A.w~0").get(0).confidence());
        assertTrue(run(p, "p.A.h~0").isEmpty(), "разные параметры — разные символы");
    }

    @Test
    void unrecognizedSizeIsLowConfidence() {
        ProjectAnalysis p = analyze("""
                class A {
                    List<Integer> load() { return new ArrayList<>(); }
                    int f() { int s = 0; for (int x : load()) for (int y : load()) s++; return s; }
                }
                """);
        List<Issue> f = run(p, "p.A.f~0");
        assertEquals(1, f.size());
        assertEquals("low", f.get(0).confidence());
    }

    @Test
    void idsUniqueOnOneLine() {
        ProjectAnalysis p = analyze("""
                class A {
                    int f(List<Integer> xs) { int s = 0; for (int x : xs) { for (int y : xs) s++; for (int z : xs) s++; } return s; }
                }
                """);
        List<Issue> f = run(p, "p.A.f~0");
        assertEquals(2, f.size());
        assertEquals(2, f.stream().map(Issue::id).distinct().count(), f.toString());
    }

    @Test
    void sharedWhileCursorIsNotNested() {
        ProjectAnalysis p = analyze("""
                class A {
                    int f(String line) {
                        int i = 0, n = 0;
                        while (i < line.length()) {
                            while (i < line.length() && line.charAt(i) == ' ') i++;
                            n++;
                            while (i < line.length() && line.charAt(i) != ' ') { i++; }
                        }
                        return n;
                    }
                }
                """);
        assertTrue(run(p, "p.A.f~0").isEmpty());
    }

    @Test
    void differentOrNoCollections() {
        ProjectAnalysis p = analyze("""
                class A {
                    List<Integer> items = new ArrayList<>();
                    int f(B other) {
                        int s = 0;
                        for (int x : items) for (int y : other.items) s++;
                        return s;
                    }
                    int seq(List<Integer> xs) { int s = 0; for (int x : xs) s++; for (int y : xs) s++; return s; }
                    int cross(List<Integer> a, List<Integer> b) { int s = 0; for (int x : a) for (int y : b) s++; return s; }
                    int consts(List<Integer> xs) { int s = 0; for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) s++; return s; }
                }
                """, """
                class B {
                    List<Integer> items = new ArrayList<>();
                    int g(A a) { int s = 0; for (int x : items) for (int y : a.items) s++; return s; }
                }
                """);
        for (String id : List.of("p.A.f~0", "p.A.seq~0", "p.A.cross~0", "p.A.consts~0", "p.B.g~0")) {
            assertTrue(run(p, id).isEmpty(), id);
        }
    }

    @Test
    void demoOrderServiceMerge() throws IOException {
        ProjectAnalysis demo = ProjectAnalysis.of(ProjectAnalysisTest.demoFiles());
        List<Issue> all = DetectorRegistry.defaults().run(demo);
        assertTrue(all.stream().anyMatch(i -> i.rule().equals("NestedLoopSameCollection")
                && i.methodId().equals("com.demo.service.OrderService.merge~0")
                && i.confidence().equals("high")), all.toString());
        assertTrue(all.stream().noneMatch(i -> i.methodId().equals("com.demo.util.CommandLine.parse~0")), all.toString());
    }
}
