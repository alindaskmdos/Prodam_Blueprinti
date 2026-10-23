package blueprints.analysis;

import static blueprints.analysis.ProjectAnalysisTest.analyze;
import static blueprints.analysis.ProjectAnalysisTest.m;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
import java.io.IOException;
import java.util.List;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class ExpensiveCallInLoopTest {
    private static final Detector D = new ExpensiveCallInLoop();

    private static List<Issue> run(ProjectAnalysis p, String id) {
        return D.detect(m(p, id), p);
    }

    @Test
    void linearProjectMethodInLoop() {
        ProjectAnalysis p = analyze("""
                class A {
                    int total(List<Integer> xs) { int s = 0; for (int x : xs) s += x; return s; }
                    int f(List<Integer> orders, List<Integer> prices) {
                        int s = 0;
                        for (int o : orders) {
                            s += total(prices);
                        }
                        return s;
                    }
                }
                """);
        List<Issue> f = run(p, "p.A.f~0");
        assertEquals(1, f.size());
        Issue i = f.get(0);
        assertEquals("ExpensiveCallInLoop", i.rule());
        assertEquals("high", i.confidence());
        assertEquals(new blueprints.model.Span("src/p/F0.java", 8, 8), i.span());
        assertEquals("O(n·m)", i.complexity().before());
        assertTrue(i.message().contains("total()"), i.message());
    }

    @Test
    void expensiveJdkCallNotCoveredByLinearSearch() {
        ProjectAnalysis p = analyze("""
                class A {
                    void f(List<Integer> xs, List<Integer> ys) { for (int x : xs) Collections.sort(ys); }
                    int g(List<String> xs, Map<String, Integer> m) { int s = 0; for (String x : xs) if (m.containsValue(s)) s++; return s; }
                }
                """);
        List<Issue> f = run(p, "p.A.f~0");
        assertEquals(1, f.size());
        assertEquals("high", f.get(0).confidence());
        assertTrue(f.get(0).complexity().before().contains("log"), f.get(0).complexity().before());
        assertEquals(1, run(p, "p.A.g~0").size());
    }

    @Test
    void cheapOutsideAndListSearchAreSilent() {
        ProjectAnalysis p = analyze("""
                class A {
                    int one(int x) { return x + 1; }
                    int cheap(List<Integer> xs, Map<Integer, Integer> m) { int s = 0; for (int x : xs) { s += one(x) + m.get(x) + xs.get(0); } return s; }
                    int total(List<Integer> xs) { int s = 0; for (int x : xs) s += x; return s; }
                    int outside(List<Integer> xs) { return total(xs); }
                    int search(List<Integer> xs, List<Integer> ws) { int s = 0; for (int x : xs) { if (ws.contains(x)) s++; ws.remove(x); s += ws.indexOf(x); } return s; }
                    int consts(List<Integer> xs) { int s = 0; for (int i = 0; i < 3; i++) s += total(xs); return s; }
                    void logs(List<Integer> xs, TreeMap<Integer, Integer> t) { for (int x : xs) t.put(x, x); }
                    int elem(List<B> bs) { int s = 0; for (B b : bs) s += b.sum(); return s; }
                }
                """, """
                class B { List<Integer> items = new ArrayList<>(); int sum() { int s = 0; for (int x : items) s += x; return s; } }
                """);
        for (String id : List.of("p.A.elem~0", "p.A.cheap~0", "p.A.outside~0", "p.A.search~0", "p.A.consts~0", "p.A.logs~0")) {
            assertTrue(run(p, id).isEmpty(), id + ": " + run(p, id));
        }
    }

    @Test
    void recursionAndUnknownSizesAreLowOrSilent() {
        ProjectAnalysis p = analyze("""
                class A {
                    int total(List<Integer> xs) { int s = 0; for (int x : xs) s += x; return s; }
                    List<Integer> load() { return new ArrayList<>(); }
                    int rec(List<Integer> xs, int d) { if (d == 0) return 0; int s = 0; for (int x : xs) s += x; return s + rec(xs, d - 1); }
                    int even(List<Integer> xs, int d) { int s = 0; for (int x : xs) s += odd(xs, d - 1); return s; }
                    int odd(List<Integer> xs, int d) { return d <= 0 ? 0 : even(xs, d - 1); }
                    int viaRec(List<Integer> xs) { int s = 0; for (int x : xs) s += rec(xs, x); return s; }
                    int both(List<Integer> a, List<Integer> b) { return total(a) + total(b); }
                    int fresh(List<Integer> xs, List<Integer> ys) { int s = 0; for (int x : xs) s += both(ys, load()); return s; }
                    int allFresh(List<Integer> xs) { int s = 0; for (int x : xs) s += total(load()); return s; }
                }
                """);
        assertEquals("low", run(p, "p.A.viaRec~0").get(0).confidence(), "вызываемый рекурсивен");
        assertEquals("low", run(p, "p.A.fresh~0").get(0).confidence(), "размер одного аргумента не распознан");
        assertEquals("low", run(p, "p.A.allFresh~0").get(0).confidence(), "нераспознанный размер — в «Предупреждения» (§8.2)");
        assertTrue(run(p, "p.A.even~0").isEmpty(), "вызов внутри цикла графа — стоимость неизвестна");
        assertTrue(run(p, "p.A.rec~0").isEmpty());
    }

    @Test
    void elementDataIsOnePassButSharedDataIsReported() {
        ProjectAnalysis p = analyze("""
                class A {
                    List<B> all = new ArrayList<>();
                    int recv(List<B> bs) { int s = 0; for (B b : bs) s += b.sum(); return s; }
                    int arg(List<B> bs) { int s = 0; for (B b : bs) s += sumOf(b); return s; }
                    int pair(List<B> bs) { int s = 0; for (B a : bs) for (B b : bs) s += absorb(a, b); return s; }
                    int pairFixed(List<B> bs) { int s = 0; for (B a : bs) for (int i = 0; i < 2; i++) s += absorb(a, a); return s; }
                    int outerElem(List<B> bs) { int s = 0; for (B a : bs) for (B b : bs) s += sumOf(a); return s; }
                    int outerRecv(List<B> bs) { int s = 0; for (B a : bs) for (B b : bs) s += a.sum(); return s; }
                    int lines(List<B> bs) { int s = 0; for (B b : bs) s += sumList(b.items); return s; }
                    int sumOf(B b) { int s = 0; for (int x : b.items) s += x; return s; }
                    int sumList(List<Integer> xs) { int s = 0; for (int x : xs) s += x; return s; }
                    int absorb(B a, B b) { int s = 0; for (int x : a.items) for (int y : b.items) s += x * y; return s; }
                    int other(List<B> bs) { int s = 0; for (B b : bs) s += b.countIn(all); return s; }
                    int shared(List<B> bs) { int s = 0; for (B b : bs) s += b.inRegistry(); return s; }
                    int foreign(List<B> bs, List<Integer> ys) { int s = 0; for (B b : bs) s += sumList(ys); return s; }
                }
                """, """
                class B {
                    static List<Integer> REGISTRY = new ArrayList<>();
                    List<Integer> items = new ArrayList<>();
                    int sum() { int s = 0; for (int x : items) s += x; return s; }
                    int countIn(List<B> xs) { int s = 0; for (B x : xs) if (x == this) s++; return s; }
                    int inRegistry() { int s = 0; for (int x : REGISTRY) s += x; return s; }
                }
                """);
        for (String id : List.of("p.A.recv~0", "p.A.arg~0", "p.A.pairFixed~0", "p.A.lines~0")) {
            assertTrue(run(p, id).isEmpty(), id + ": " + run(p, id));
        }
        // данные внешнего элемента обходятся заново на каждой итерации внутреннего цикла; размер b.items внутри
        // sumOf/absorb не распознан (fresh, §8.2) → low, поле B.items у получателя — распознано → high
        assertEquals("low", run(p, "p.A.outerElem~0").get(0).confidence());
        assertEquals("low", run(p, "p.A.pair~0").get(0).confidence());
        for (String id : List.of("p.A.other~0", "p.A.shared~0", "p.A.foreign~0", "p.A.outerRecv~0")) {
            assertEquals(1, run(p, id).size(), id);
            assertEquals("high", run(p, id).get(0).confidence(), id);
        }
    }

    @Test
    void stringLengthAndIntParamsAreSilent() {
        ProjectAnalysis p = analyze("""
                class A {
                    static String padLeft(String s, int width) { StringBuilder b = new StringBuilder(); for (int i = s.length(); i < width; i++) b.append(' '); return b + s; }
                    static int repeat(int k) { int s = 0; for (int i = 0; i < k; i++) s += i; return s; }
                    String table(List<String> names, String title, int w) {
                        String out = "";
                        for (String n : names) out += padLeft(n, 10) + padLeft(title, w) + repeat(w);
                        return out;
                    }
                }
                """);
        assertTrue(run(p, "p.A.table~0").isEmpty(), run(p, "p.A.table~0").toString());
    }

    @Test
    void scalarParamLookupInCollectionIsReported() {
        ProjectAnalysis p = analyze("""
                class A {
                    C catalog = new C();
                    R repo = new R();
                    static String padDo(String s, int width) { String r = s; do { if (r.length() >= width) break; r = " " + r; } while (true); return r; }
                    static boolean isInt(String s) { for (int i = 0; i < s.length(); i++) if (!Character.isDigit(s.charAt(i))) return false; return true; }
                    boolean isKnown(int id) { for (int x : catalog.items()) if (x == id) return true; return false; }
                    int findById(int id) { for (int x : repo.findAll()) if (x == id) return x; return -1; }
                    int known(List<Integer> ids) { int s = 0; for (int id : ids) if (isKnown(id)) s++; return s; }
                    int found(List<Integer> ids) { int s = 0; for (int id : ids) s += findById(id); return s; }
                    String pads(List<String> xs) { String out = ""; for (String x : xs) out += padDo(x, 8) + isInt(x); return out; }
                }
                """, """
                class C { List<Integer> items() { return new ArrayList<>(); } }
                """, """
                class R { List<Integer> findAll() { return new ArrayList<>(); } }
                """);
        assertEquals("low", run(p, "p.A.known~0").get(0).confidence(), "размер catalog.items() не распознан (§8.2)");
        assertEquals("low", run(p, "p.A.found~0").get(0).confidence(), "размер repo.findAll() не распознан (§8.2)");
        assertTrue(run(p, "p.A.pads~0").isEmpty(), run(p, "p.A.pads~0").toString());
    }

    @Test
    void demo() throws IOException {
        ProjectAnalysis demo = ProjectAnalysis.of(ProjectAnalysisTest.demoFiles());
        List<Issue> found = DetectorRegistry.defaults().run(demo).stream()
                .filter(i -> i.rule().equals("ExpensiveCallInLoop")).toList();
        String high = found.stream().filter(i -> i.confidence().equals("high"))
                .map(i -> i.methodId().replace("com.demo.service.", "") + ":" + i.span().startLine()).collect(Collectors.joining(", "));
        // всё high — настоящий N+1: линейный поиск в каталоге (findProduct/findCustomer) на каждой итерации
        assertEquals("InventoryService.reserve~0:24, InventoryService.rollback~0:46, PricingService.subtotal~0:56, "
                + "ReportService.fullReport~0:40", high);
        String low = found.stream().filter(i -> i.confidence().equals("low"))
                .map(i -> i.methodId().replace("com.demo.", "") + ":" + i.span().startLine()).collect(Collectors.joining(", "));
        assertEquals("Main.main~0:45, service.InventoryService.reserve~0:26, service.InventoryService.reserve~0:32, "
                + "service.OrderService.merge~0:47, service.OrderService.reserveAll~0:77, service.ReportService.fullReport~0:42, "
                + "service.ReportService.customerSummary~0:119, service.Validator.check~0:45", low);
        assertEquals(12, found.size());
    }
}
