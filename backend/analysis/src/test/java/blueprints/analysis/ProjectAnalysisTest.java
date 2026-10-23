package blueprints.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.source.SourceFile;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.stmt.ForStmt;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class ProjectAnalysisTest {
    static ProjectAnalysis analyze(String... classes) {
        List<SourceFile> files = new ArrayList<>();
        for (int i = 0; i < classes.length; i++) {
            files.add(new SourceFile("src/p/F" + i + ".java", "p",
                    ("package p;\nimport java.util.*;\n" + classes[i]).getBytes(StandardCharsets.UTF_8)));
        }
        return ProjectAnalysis.of(files);
    }

    static MethodAnalysis m(ProjectAnalysis p, String id) {
        MethodAnalysis m = p.method(id);
        assertNotNull(m, id);
        return m;
    }

    @Test
    void loopBounds() {
        ProjectAnalysis p = analyze("""
                class A {
                    int each(List<Integer> xs) { int s = 0; for (int x : xs) s += x; return s; }
                    int bySize(List<Integer> xs) { int s = 0; for (int i = 0; i < xs.size(); i++) s++; return s; }
                    int byLength(int[] a) { int s = 0; for (int i = a.length - 1; i >= 0; i--) s++; return s; }
                    int byParam(int n) { int s = 0; for (int i = 0; i < n; i++) s++; return s; }
                    int constant() { int s = 0; for (int i = 0; i < 10; i++) s++; return s; }
                    int halving(int n) { int s = 0; for (int i = n; i > 0; i /= 2) s++; return s; }
                    int nested(List<Integer> a, List<Integer> b) { int s = 0; for (int x : a) for (int y : b) s++; return s; }
                }
                """);
        assertEquals("O(xs)", m(p, "p.A.each~0").complexity().raw());
        assertEquals("O(xs)", m(p, "p.A.bySize~0").complexity().raw());
        assertEquals("O(a)", m(p, "p.A.byLength~0").complexity().raw());
        assertEquals("O(n)", m(p, "p.A.byParam~0").complexity().raw());
        assertEquals("O(1)", m(p, "p.A.constant~0").complexity().raw());
        assertEquals("O(log n)", m(p, "p.A.halving~0").complexity().raw());
        assertEquals("O(n·m)", m(p, "p.A.nested~0").complexity().toString());
        assertEquals("high", m(p, "p.A.nested~0").confidence());
    }

    @Test
    void whileIsLowConfidence() {
        ProjectAnalysis p = analyze("""
                class A {
                    int w(String line) { int i = 0; while (i < line.length()) i++; return i; }
                }
                """);
        MethodAnalysis w = m(p, "p.A.w~0");
        assertEquals("O(line)", w.complexity().raw());
        assertEquals("low", w.confidence());
        assertFalse(w.warnings().isEmpty());
    }

    @Test
    void sizeSymbolsFlowThroughCopiesAndStreams() {
        ProjectAnalysis p = analyze("""
                class A {
                    int f(List<Integer> a) {
                        List<Integer> b = a;
                        List<Integer> c = new ArrayList<>(a);
                        List<Integer> d = List.copyOf(a);
                        List<Integer> e = a.stream().filter(x -> x > 0).map(x -> x).toList();
                        List<Integer> g = a.subList(0, 1);
                        int[] h = new int[a.size()];
                        int s = 0;
                        for (int x : b) for (int y : c) for (int z : d) for (int u : e) for (int v : g) for (int w : h) s++;
                        return s;
                    }
                }
                """);
        assertEquals("O(a^6)", m(p, "p.A.f~0").complexity().raw());
    }

    @Test
    void addInLoopAndAddAll() {
        ProjectAnalysis p = analyze("""
                class A {
                    List<Integer> dedup(List<Integer> ids) {
                        List<Integer> out = new ArrayList<>();
                        for (int i = 0; i < ids.size(); i++) {
                            if (out.indexOf(ids.get(i)) < 0) out.add(ids.get(i));
                        }
                        return out;
                    }
                    int both(List<Integer> b, List<Integer> c) {
                        List<Integer> all = new ArrayList<>(b);
                        all.addAll(c);
                        int s = 0;
                        for (int x : all) s++;
                        return s;
                    }
                }
                """);
        MethodAnalysis dedup = m(p, "p.A.dedup~0");
        // out растёт до ids, indexOf внутри цикла — O(n²)
        assertEquals("O(ids²)", dedup.complexity().raw());
        MethodCallExpr indexOf = dedup.declaration().findFirst(MethodCallExpr.class, c -> c.getNameAsString().equals("indexOf")).orElseThrow();
        assertEquals("O(ids)", dedup.callCost(indexOf).raw());
        assertEquals(1, dedup.enclosingLoops(indexOf).size());
        assertEquals("ArrayList", dedup.typeOf("out"));
        assertEquals("O(b + c)", m(p, "p.A.both~0").complexity().raw());
    }

    @Test
    void parametersReceiveArgumentSymbols() {
        ProjectAnalysis p = analyze("""
                class A {
                    int merge(List<Integer> x, List<Integer> y) { int s = 0; for (int a : x) for (int b : y) s++; return s; }
                    int caller(List<Integer> orders, List<Integer> other) { return merge(orders, orders) + helper(other); }
                    private int helper(List<Integer> z) { return merge(z, List.of(1)); }
                }
                """);
        assertEquals("O(n² + m)", m(p, "p.A.caller~0").complexity().toString());
        assertEquals("O(orders² + other)", m(p, "p.A.caller~0").complexity().raw());
        assertEquals("O(z)", m(p, "p.A.helper~0").complexity().raw());
        assertEquals(java.util.Set.of("p.A.merge~0", "p.A.helper~0"), p.callGraph().callees("p.A.caller~0"));
    }

    @Test
    void calleeFieldDoesNotMergeWithSameNamedCallerSymbol() {
        ProjectAnalysis p = analyze("""
                class Store {
                    List<Integer> orders = new ArrayList<>();
                    int scan() { int s = 0; for (int x : orders) s++; return s; }
                    int twice() { int s = 0; for (int x : orders) s += scan(); return s; }
                }
                """, """
                class Svc {
                    Store store = new Store();
                    int run(List<Integer> orders) { int s = 0; for (int o : orders) s += store.scan(); return s; }
                }
                """);
        MethodAnalysis run = m(p, "p.Svc.run~0");
        assertEquals("O(n·m)", run.complexity().toString());
        assertEquals(2, run.complexity().symbols().size());
        assertEquals("high", run.confidence());
        // поле того же класса — один и тот же символ
        assertEquals("O(n²)", m(p, "p.Store.twice~0").complexity().toString());
    }

    @Test
    void unrecognizedSizeIsFreshSymbolWithWarning() {
        ProjectAnalysis p = analyze("""
                class A {
                    List<Integer> load() { return null; }
                    int f() { int s = 0; for (int x : load()) s++; return s; }
                }
                """);
        MethodAnalysis f = m(p, "p.A.f~0");
        assertEquals("O(load())", f.complexity().raw());
        assertEquals("low", f.confidence());
    }

    @Test
    void recursionAndMutualRecursion() {
        ProjectAnalysis p = analyze("""
                class A {
                    int fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
                    boolean even(int n) { return n == 0 || odd(n - 1); }
                    boolean odd(int n) { return n != 0 && even(n - 1); }
                    int user(int n) { return fact(n); }
                }
                """);
        CallGraph g = p.callGraph();
        assertTrue(g.isRecursive("p.A.fact~0"));
        assertTrue(g.sameCycle("p.A.even~0", "p.A.odd~0"));
        assertFalse(g.isRecursive("p.A.user~0"));
        assertEquals("low", m(p, "p.A.fact~0").confidence());
        assertTrue(m(p, "p.A.fact~0").warnings().contains("рекурсия, оценка неточная"));
        assertEquals("low", m(p, "p.A.user~0").confidence());
        assertEquals("low", m(p, "p.A.odd~0").confidence());
    }

    @Test
    void callResolutionAcrossClassesOverloadsAndConstructors() {
        ProjectAnalysis p = analyze("""
                class Repo {
                    List<Integer> items = new ArrayList<>();
                    Repo() {}
                    Repo(int cap) {}
                    boolean has(int id) { return items.contains(id); }
                    boolean has(int id, int other) { return false; }
                }
                """, """
                class Svc {
                    Repo repo = new Repo(4);
                    int count(List<Integer> ids) {
                        int c = 0;
                        for (int id : ids) if (repo.has(id)) c++;
                        return c;
                    }
                    void make() { new Repo(); }
                    void anon() { Runnable r = new Runnable() { public void run() {} }; r.run(); }
                }
                """);
        assertEquals(java.util.Set.of("p.Repo.has~0"), p.callGraph().callees("p.Svc.count~0"));
        assertEquals("O(items·ids)", m(p, "p.Svc.count~0").complexity().raw());
        assertEquals(java.util.Set.of("p.Repo.<init>~0"), p.callGraph().callees("p.Svc.make~0"));
        assertTrue(p.callGraph().callees("p.Svc.anon~0").isEmpty());
        assertEquals(java.util.Set.of("p.Svc.count~0"), p.callGraph().callers("p.Repo.has~0"));
    }

    @Test
    void loopSizesForDetectors() {
        ProjectAnalysis p = analyze("""
                class A {
                    List<Integer> orders = new ArrayList<>();
                    int merge() {
                        int k = 0;
                        for (int i = 0; i < orders.size(); i++)
                            for (int j = i + 1; j < orders.size(); j++) k++;
                        return k;
                    }
                    void lambda(List<Integer> xs) { xs.forEach(x -> { if (orders.contains(x)) {} }); }
                }
                """);
        MethodAnalysis merge = m(p, "p.A.merge~0");
        List<ForStmt> loops = merge.declaration().findAll(ForStmt.class);
        assertEquals(merge.loopSize(loops.get(0)), merge.loopSize(loops.get(1)));
        assertEquals("O(n²)", merge.complexity().toString());
        assertNull(merge.loopSize(merge.declaration()));
        assertEquals(List.of(loops.get(0)), merge.enclosingLoops(loops.get(1)));

        MethodAnalysis lambda = m(p, "p.A.lambda~0");
        MethodCallExpr contains = lambda.declaration().findFirst(MethodCallExpr.class, c -> c.getNameAsString().equals("contains")).orElseThrow();
        assertEquals(1, lambda.enclosingLoops(contains).size());
        assertEquals("O(xs·orders)", lambda.complexity().raw());
    }

    @Test
    void unparsableFileIsSkipped() {
        ProjectAnalysis p = analyze("class A { void f() { int x = ; } }", "class B { void g() {} }");
        assertEquals(1, p.warnings().size());
        assertNotNull(p.method("p.B.g~0"));
        assertNull(p.method("p.A.f~0"));
    }

    @Test
    void wholeSampleCorpusWithoutExceptions() throws IOException {
        for (String dir : List.of("../../samples/demo/src", "../../samples/roundtrip")) {
            List<SourceFile> files = new ArrayList<>();
            try (Stream<Path> s = Files.walk(Path.of(dir))) {
                for (Path f : s.filter(x -> x.toString().endsWith(".java")).sorted().toList()) {
                    String text = Files.readString(f);
                    String pkg = text.lines().filter(l -> l.startsWith("package ")).findFirst()
                            .map(l -> l.substring(8, l.indexOf(';')).trim()).orElse("");
                    files.add(new SourceFile(f.toString(), pkg, text.getBytes(StandardCharsets.UTF_8)));
                }
            }
            ProjectAnalysis p = ProjectAnalysis.of(files);
            List<MethodAnalysis> all = p.methods();
            assertFalse(all.isEmpty(), dir);
            all.forEach(x -> assertNotNull(x.complexity(), x.id()));
            assertTrue(DetectorRegistry.defaults().run(p).isEmpty());
        }
        ProjectAnalysis demo = ProjectAnalysis.of(demoFiles());
        assertEquals("O(n²)", demo.method("com.demo.service.InventoryService.distinctIds~0").complexity().toString());
        assertEquals("O(n·m)", demo.method("com.demo.service.InventoryService.watched~0").complexity().toString());
        assertTrue(demo.callGraph().callees("com.demo.service.OrderService.merge~0")
                .contains("com.demo.service.OrderService.absorb~0"));
    }

    private static List<SourceFile> demoFiles() throws IOException {
        List<SourceFile> files = new ArrayList<>();
        Path root = Path.of("../../samples/demo/src");
        try (Stream<Path> s = Files.walk(root)) {
            for (Path f : s.filter(x -> x.toString().endsWith(".java")).sorted().toList()) {
                String rel = root.relativize(f.getParent()).toString().replace('\\', '.').replace('/', '.');
                files.add(new SourceFile("src/" + root.relativize(f).toString().replace('\\', '/'), rel, Files.readAllBytes(f)));
            }
        }
        return files;
    }
}
