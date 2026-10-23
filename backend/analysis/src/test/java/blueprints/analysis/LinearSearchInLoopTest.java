package blueprints.analysis;

import static blueprints.analysis.ProjectAnalysisTest.analyze;
import static blueprints.analysis.ProjectAnalysisTest.m;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class LinearSearchInLoopTest {
    private static final Detector D = new LinearSearchInLoop();

    private static List<Issue> run(ProjectAnalysis p, String id) {
        return D.detect(m(p, id), p);
    }

    @Test
    void listContainsInLoop() {
        ProjectAnalysis p = analyze("""
                class A {
                    int f(List<Integer> xs, List<Integer> watch) {
                        int s = 0;
                        for (int x : xs) {
                            if (watch.contains(x)) s++;
                        }
                        return s;
                    }
                    List<Integer> dedup(List<Integer> ids) {
                        List<Integer> out = new ArrayList<>();
                        for (int i = 0; i < ids.size(); i++) if (out.indexOf(ids.get(i)) < 0) out.add(ids.get(i));
                        return out;
                    }
                    void rm(List<Integer> xs, List<String> names, String n) { for (int x : xs) names.remove(n); }
                }
                """);
        List<Issue> f = run(p, "p.A.f~0");
        assertEquals(1, f.size());
        Issue i = f.get(0);
        assertEquals("LinearSearchInLoop", i.rule());
        assertEquals("high", i.confidence());
        assertEquals(new blueprints.model.Span("src/p/F0.java", 7, 7), i.span());
        assertEquals("O(n·m)", i.complexity().before());
        assertTrue(i.message().contains("watch"), i.message());
        assertTrue(i.recommendation().contains("LinkedHashSet"));

        List<Issue> d = run(p, "p.A.dedup~0");
        assertEquals(1, d.size());
        assertEquals("high", d.get(0).confidence());
        assertEquals("O(n²)", d.get(0).complexity().before());
        assertEquals(1, run(p, "p.A.rm~0").size());
    }

    @Test
    void setOutsideLoopIndexAndConstantLoopAreSilent() {
        ProjectAnalysis p = analyze("""
                class A {
                    int set(List<Integer> xs, Set<Integer> watch) { int s = 0; for (int x : xs) if (watch.contains(x)) s++; return s; }
                    int map(List<Integer> xs, Map<Integer, String> m) { int s = 0; for (int x : xs) if (m.containsKey(x)) s++; return s; }
                    int str(List<String> xs, String line) { int s = 0; for (String x : xs) if (line.contains(x)) s++; return s; }
                    boolean outside(List<Integer> xs, int v) { return xs.contains(v); }
                    void byIndex(List<Integer> xs) { for (int i = 0; i < xs.size(); i++) xs.remove(0); }
                    void last(List<Integer> xs) { for (int i = 0; i < xs.size(); i++) xs.remove(xs.size() - 1); }
                    void exprs(List<Integer> xs, int[] arr, long x, short sh, char c) {
                        for (int i = 0; i < xs.size(); i++) { xs.remove(i + 1); xs.remove(arr[i]); xs.remove((int) x); xs.remove(i++); xs.remove(sh); xs.remove(c); }
                    }
                    int consts(List<Integer> xs) { int s = 0; for (int i = 0; i < 3; i++) if (xs.contains(i)) s++; return s; }
                    int project(List<Integer> xs, B b) { int s = 0; for (int x : xs) if (b.contains(x)) s++; return s; }
                }
                """, """
                class B { boolean contains(int x) { return x > 0; } }
                """);
        for (String id : List.of("p.A.set~0", "p.A.map~0", "p.A.str~0", "p.A.outside~0", "p.A.byIndex~0", "p.A.last~0", "p.A.exprs~0",
                "p.A.consts~0", "p.A.project~0")) {
            assertTrue(run(p, id).isEmpty(), id);
        }
    }

    @Test
    void unknownReceiverOrFreshSizeIsLow() {
        ProjectAnalysis p = analyze("""
                class A {
                    List<Integer> load() { return new ArrayList<>(); }
                    int f(List<Integer> xs, B b) { int s = 0; for (int x : xs) if (b.items.contains(x)) s++; return s; }
                    int g(List<Integer> xs) { int s = 0; List<Integer> got = load(); for (int x : xs) if (got.contains(x)) s++; return s; }
                    int w(List<Integer> xs, int k) { int s = 0; while (s < k) { if (xs.contains(s)) s++; else break; } return s; }
                    int coll(List<Integer> xs, Collection<Integer> c) { int s = 0; for (int x : xs) if (c.contains(x)) s++; return s; }
                    void rmVar(List<Integer> xs, List<Integer> ys) { xs.forEach(v -> ys.remove(v)); }
                    int iter(List<Integer> xs) { int s = 0; for (int x : load()) if (xs.contains(x)) s++; return s; }
                }
                """, """
                class B { List<Integer> items = new ArrayList<>(); }
                """);
        assertEquals("low", run(p, "p.A.f~0").get(0).confidence());
        assertEquals("low", run(p, "p.A.g~0").get(0).confidence());
        assertEquals("low", run(p, "p.A.w~0").get(0).confidence());
        assertEquals("low", run(p, "p.A.coll~0").get(0).confidence(), "Collection может быть Set");
        assertEquals("low", run(p, "p.A.rmVar~0").get(0).confidence(), "тип аргумента remove неизвестен");
        assertEquals("high", run(p, "p.A.iter~0").get(0).confidence(), "нераспознанное итерируемое — поиск всё равно линеен");
    }

    @Test
    void freshSizeFromSameLoopIsHighUnrelatedIsLow() {
        ProjectAnalysis p = analyze("""
                class A {
                    List<Integer> load() { return new ArrayList<>(); }
                    int seen() {
                        int s = 0;
                        List<Integer> seen = new ArrayList<>();
                        for (int x : load()) { if (seen.contains(x)) s++; else seen.add(x); }
                        return s;
                    }
                    int unrelated(List<Integer> xs) {
                        int s = 0;
                        List<Integer> got = new ArrayList<>(load());
                        for (int x : xs) if (got.contains(x)) s++;
                        return s;
                    }
                }
                """);
        assertEquals("high", run(p, "p.A.seen~0").get(0).confidence(), "список растёт от того же нераспознанного цикла");
        assertEquals("low", run(p, "p.A.unrelated~0").get(0).confidence(), "fresh-размер не связан с циклом");
    }

    @Test
    void sameNamedCollectionsInDifferentClasses() {
        ProjectAnalysis p = analyze("""
                class A {
                    List<Integer> ids = new ArrayList<>();
                    int f(List<Integer> xs) { int s = 0; for (int x : xs) if (ids.contains(x)) s++; return s; }
                }
                """, """
                class B {
                    Set<Integer> ids = new LinkedHashSet<>();
                    int f(List<Integer> xs) { int s = 0; for (int x : xs) if (ids.contains(x)) s++; return s; }
                }
                """);
        List<Issue> a = run(p, "p.A.f~0");
        assertEquals(1, a.size());
        assertEquals("high", a.get(0).confidence());
        assertTrue(run(p, "p.B.f~0").isEmpty());
    }

    @Test
    void demo() throws IOException {
        ProjectAnalysis demo = ProjectAnalysis.of(ProjectAnalysisTest.demoFiles());
        Map<String, String> found = DetectorRegistry.defaults().run(demo).stream()
                .filter(i -> i.rule().equals("LinearSearchInLoop"))
                .collect(Collectors.toMap(Issue::methodId, Issue::confidence, (x, y) -> x, java.util.LinkedHashMap::new));
        assertEquals("high", found.get("com.demo.service.InventoryService.watched~0"), found.toString());
        assertEquals("high", found.get("com.demo.service.InventoryService.distinctIds~0"), found.toString());
        assertEquals("high", found.get("com.demo.service.Validator.checkLines~0"), found.toString());
        assertEquals(3, found.size(), found.toString());
    }
}
