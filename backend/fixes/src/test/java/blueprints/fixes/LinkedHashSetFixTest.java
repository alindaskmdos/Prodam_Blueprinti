package blueprints.fixes;

import static org.junit.jupiter.api.Assertions.*;

import blueprints.analysis.LinearSearchInLoop;
import blueprints.analysis.MethodAnalysis;
import blueprints.analysis.ProjectAnalysis;
import blueprints.model.Issue;
import blueprints.testing.VerifyResult;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class LinkedHashSetFixTest {

    private static final String FILE = "src/p/A.java";
    private final LinkedHashSetFix fix = new LinkedHashSetFix();

    private static Map<String, String> project(String imports, String body) {
        Map<String, String> files = new LinkedHashMap<>();
        files.put(FILE, "package p;\n" + imports + "class A {\n    List<Integer> f = new ArrayList<>();\n" + body + "}\n");
        return files;
    }

    private static Map<String, String> project(String body) {
        return project("import java.util.ArrayList;\nimport java.util.List;\n", body);
    }

    /** id находок LinearSearchInLoop — как их выдаёт детектор. */
    private static List<String> issues(Map<String, String> files) {
        ProjectAnalysis p = ProjectAnalysis.of(FixText.sources(files));
        List<String> out = new ArrayList<>();
        for (MethodAnalysis m : p.methods()) for (Issue i : new LinearSearchInLoop().detect(m, p)) out.add(i.id());
        return out;
    }

    private static String only(Map<String, String> files) {
        List<String> ids = issues(files);
        assertEquals(1, ids.size(), ids.toString());
        return ids.get(0);
    }

    @Test
    void containsRewrittenOnlyInNeededRangesWithImports() {
        Map<String, String> files = project("""
                    int count(List<Integer> xs, List<Integer> ys) {
                        int n = 0;
                        for (Integer y : ys) {
                            if (xs /* keep */ .contains(y) || xs.contains(7)) n++;   // comment stays
                        }
                        return n;
                    }
                """);
        List<String> ids = issues(files);
        assertEquals(2, ids.size(), ids.toString());
        Map<String, String> r = fix.apply(files, ids.get(0));
        assertEquals(project("import java.util.ArrayList;\nimport java.util.List;\nimport java.util.LinkedHashSet;\nimport java.util.Set;\n", """
                    int count(List<Integer> xs, List<Integer> ys) {
                        int n = 0;
                        Set<Integer> xsSet = xs == null ? null : new LinkedHashSet<>(xs);
                        for (Integer y : ys) {
                            if (xsSet /* keep */ .contains(y) || xsSet.contains(7)) n++;   // comment stays
                        }
                        return n;
                    }
                """), r);
        assertEquals(List.of(), issues(r), "поиска по списку в цикле не осталось");
    }

    @Test
    void existingImportsCrlfAndNameCollision() {
        Map<String, String> files = project("import java.util.*;\n", """
                    int g(List<String> xs, List<String> ys) {
                        int xsSet = 0;
                        for (String y : ys) if (xs.contains(y)) xsSet++;
                        return xsSet;
                    }
                """);
        files.replaceAll((k, v) -> v.replace("\n", "\r\n"));
        String out = fix.apply(files, only(files)).get(FILE);
        assertTrue(out.startsWith("package p;\r\nimport java.util.*;\r\nclass A"), out);
        assertTrue(out.contains("Set<String> xsSet2 = xs == null ? null : new LinkedHashSet<>(xs);\r\n        for (String y : ys) if (xsSet2.contains(y)) xsSet++;"), out);
        assertFalse(out.replace("\r\n", "").contains("\n"), "перевод строки файла сохранён");
    }

    @Test
    void localListAndFieldWithoutCalls() {
        Map<String, String> files = project("""
                    int h(int[] a) {
                        List<Integer> seen = new ArrayList<>();
                        seen.add(1);
                        int n = 0;
                        for (int v : a) {
                            if (seen.contains(v)) n++;
                        }
                        for (int v : a) if (f.contains(v)) n++;
                        return n;
                    }
                """);
        List<String> ids = issues(files);
        assertEquals(2, ids.size(), ids.toString());
        for (String id : ids) assertTrue(fix.canApply(files, id), id);
        assertTrue(fix.apply(files, ids.get(1)).get(FILE).contains("Set<Integer> fSet = f == null ? null : new LinkedHashSet<>(f);"));
    }

    @Test
    void unsafeShapesAreRejected() {
        List<String> bodies = List.of(
                // список меняется в цикле
                "void a(List<Integer> xs, int[] a) { for (int v : a) { if (!xs.contains(v)) xs.add(v); } }",
                "void b(List<Integer> xs, int[] a) { for (int v : a) { if (xs.contains(v)) xs.clear(); } }",
                "void c(List<Integer> xs, int[] a) { for (int v : a) { if (xs.contains(v)) xs = new ArrayList<>(); } }",
                // передаётся в метод
                "void d(List<Integer> xs, int[] a) { for (int v : a) { if (xs.contains(v)) touch(xs); } } void touch(List<Integer> l) {}",
                // алиас и view до цикла
                "void e(List<Integer> xs, int[] a) { List<Integer> b = xs; for (int v : a) { if (xs.contains(v)) b.add(v); } }",
                "void g(List<Integer> xs, int[] a) { List<Integer> b = xs.subList(0, 1); for (int v : a) { if (xs.contains(v)) b.clear(); } }",
                "void g2(int[] a) { List<Integer> xs = new ArrayList<>(); List<Integer> r = xs.reversed(); for (int v : a) { if (!xs.contains(v)) r.add(v); } }",
                "void g4(int[] a) { LinkedList<Integer> xs = new LinkedList<>(); java.util.Iterator<Integer> it = xs.descendingIterator(); for (int v : a) { if (xs.contains(v)) it.remove(); } }",
                "void g3(int[] a) { List<Integer> xs = new ArrayList<>(); List<Integer> r = xs.subList(0, 0); for (int v : a) { if (!xs.contains(v)) r.add(v); } }",
                // лямбда
                "void h(List<Integer> xs, int[] a) { Runnable r = () -> xs.clear(); for (int v : a) { if (xs.contains(v)) r.run(); } }",
                "void i(List<Integer> xs, int[] a) { for (int v : a) { Runnable r = () -> xs.contains(v); } }",
                // поле и вызов в цикле
                "void j(int[] a) { for (int v : a) { if (f.contains(v)) reset(); } } void reset() { f.clear(); }",
                // неизвестный / неподходящий тип элемента
                "void k(List xs, int[] a) { for (int v : a) xs.contains(v); }",
                "void l(List<Object> xs, int[] a) { for (int v : a) xs.contains(v); }",
                "void m(java.util.Collection<Integer> xs, int[] a) { for (int v : a) xs.contains(v); }",
                // не contains
                "int n(List<Integer> xs, int[] a) { int s = 0; for (int v : a) s += xs.indexOf(v); return s; }",
                // цикл без блока / с меткой
                "void o(List<Integer> xs, int[] a, boolean z) { if (z) for (int v : a) xs.contains(v); }",
                "void q(List<Integer> xs, int[] a) { out: for (int v : a) { if (xs.contains(v)) break out; } }",
                // алиас через инициализатор / присваивание самой xs
                "void s(int[] a) { List<Integer> b = new ArrayList<>(); List<Integer> xs = b; for (int v : a) { if (!xs.contains(v)) b.add(v); } }",
                "void t(int[] a) { List<Integer> b = new ArrayList<>(); List<Integer> xs = new ArrayList<>(); xs = b; for (int v : a) { if (!xs.contains(v)) b.add(v); } }",
                // параметр / значение из вызова при стороннем вызове в цикле
                "void u(List<Integer> xs, int[] a) { for (int v : a) { if (xs.contains(v)) f.add(v); } }",
                "void w(int[] a) { List<Integer> xs = f.subList(0, 0); for (int v : a) { if (xs.contains(v)) reset2(); } } void reset2() {}",
                // аргумент другого типа или нераспознанный
                "void x(List<Integer> xs, Object[] a) { for (Object v : a) xs.contains(v); }",
                "void y(List<Integer> xs, int[] a) { for (int v : a) xs.contains(v + 1); }");
        for (String body : bodies) {
            Map<String, String> files = project(body + "\n");
            List<String> ids = issues(files);
            assertFalse(ids.isEmpty(), body);
            for (String id : ids) {
                assertFalse(fix.canApply(files, id), body);
                assertThrows(IllegalArgumentException.class, () -> fix.apply(files, id), body);
            }
        }
        // чужой импорт Set
        Map<String, String> files = project("import java.util.ArrayList;\nimport java.util.List;\nimport foo.Set;\n",
                "void r(List<Integer> xs, int[] a) { for (int v : a) xs.contains(v); }\n");
        assertFalse(fix.canApply(files, only(files)));
    }

    @Test
    void badTargetsAreRejected() {
        Map<String, String> files = project("void j(List<Integer> xs, int[] a) {\n for (int v : a) xs.contains(v);\n}\n");
        String id = only(files);
        assertTrue(fix.canApply(files, id));
        for (String t : List.of("", "x", "LinearSearchInLoop:p.A.j~0:1:1", "LinearSearchInLoop:p.A.nope~0:7:17",
                "LinearSearchInLoop:p.A.j~0:a:b", id.replace("LinearSearchInLoop", "StringConcatInLoop"))) {
            assertFalse(fix.canApply(files, t), t);
        }
        assertFalse(fix.canApply(files, null));
    }

    @Test
    void registryKnowsFix() {
        assertSame(LinkedHashSetFix.class, RefactoringRegistry.defaults().byId("linked-hash-set").getClass());
    }

    // ---- samples/demo ----

    private static final Path DEMO = Path.of("../../samples/demo");

    private static Map<String, String> demo() throws IOException {
        Map<String, String> files = new LinkedHashMap<>();
        try (Stream<Path> s = Files.walk(DEMO.resolve("src"))) {
            for (Path f : s.filter(x -> x.toString().endsWith(".java")).sorted().toList()) {
                files.put(DEMO.relativize(f).toString().replace('\\', '/'), Files.readString(f));
            }
        }
        return files;
    }

    private static final String PRODUCTS_OUTSIDE = "com.demo.service.ReportService.productsOutside~0";

    @Test
    void demoOnlyProductsOutsideIsSafe() throws IOException {
        Map<String, String> files = demo();
        List<String> ids = issues(files);
        assertEquals(4, ids.size(), ids.toString());
        // watched — параметр и сторонние вызовы в цикле (catalog.products(), p.getId(), result.add); distinctIds — indexOf;
        // checkLines — seen.add в том же цикле; productsOutside — своя локальная из new ArrayList, в цикле только contains
        for (String id : ids) assertEquals(id.contains(":" + PRODUCTS_OUTSIDE + ":"), fix.canApply(files, id), id);
    }

    /** Issue.fixes, как его собирает app: только high и canApply по реестру — у productsOutside есть linked-hash-set. */
    @Test
    void demoProductsOutsideOffersFix() throws IOException {
        Map<String, String> files = demo();
        ProjectAnalysis p = ProjectAnalysis.of(FixText.sources(files));
        Issue issue = new LinearSearchInLoop().detect(p.method(PRODUCTS_OUTSIDE), p).get(0);
        assertEquals("high", issue.confidence());
        List<String> fixes = RefactoringRegistry.defaults().refactorings().stream()
                .filter(r -> r.canApply(files, issue.id())).map(Refactoring::id).toList();
        assertEquals(List.of("linked-hash-set"), fixes);
    }

    /** Фикс на demo через QualityGate: проверка поведения — реальный прогон tests/*.in, вывод совпадает с .out. */
    @Test
    void demoProductsOutsideFixKeepsIoTestsGreen(@TempDir Path tmp) throws Exception {
        Map<String, String> original = demo();
        String id = issues(original).stream().filter(i -> i.contains(":" + PRODUCTS_OUTSIDE + ":")).findFirst().orElseThrow();
        int[] runs = {0};
        QualityGate.Result r = new QualityGate(ctx -> {
            try {
                Path dir = tmp.resolve("run" + runs[0]++);
                Path classes = compile(dir, ctx.currentFiles());
                List<Path> ins;
                try (Stream<Path> s = Files.list(DEMO.resolve("tests"))) {
                    ins = s.filter(x -> x.toString().endsWith(".in")).sorted().toList();
                }
                assertFalse(ins.isEmpty());
                for (Path in : ins) {
                    Path out = in.resolveSibling(in.getFileName().toString().replace(".in", ".out"));
                    String actual = exec(classes, "com.demo.Main", in);
                    if (!actual.equals(Files.readString(out))) {
                        return new VerifyResult(VerifyResult.Status.RED, List.of(), List.of(in.getFileName().toString()));
                    }
                }
                return new VerifyResult(VerifyResult.Status.GREEN, List.of(), List.of());
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }).apply(original, original, "com.demo.Main", fix, id);
        assertTrue(r.applied(), r.reason());
        assertEquals(VerifyResult.Status.GREEN, r.verify().status());
        String patched = r.changed().get("src/com/demo/service/ReportService.java");
        assertTrue(patched.contains("knownSet.contains(id)"), patched);
        assertEquals(java.util.Set.of("src/com/demo/service/ReportService.java"), r.changed().keySet());
    }

    @Test
    void programCompilesAndKeepsOutputThroughQualityGate(@TempDir Path tmp) throws Exception {
        Map<String, String> original = new LinkedHashMap<>();
        original.put("src/p/Main.java", """
                package p;

                import java.util.ArrayList;
                import java.util.Arrays;
                import java.util.List;

                public class Main {
                    static int count(List<Integer> xs, int[] a) {
                        int n = 0;
                        for (int v : a) {
                            if (xs.contains(v)) n++;
                        }
                        return n;
                    }

                    static int seen(int[] a) {
                        List<Integer> seen = new ArrayList<>();
                        seen.add(3);
                        int n = 0;
                        for (int v : a) {
                            if (seen.contains(v)) n++;
                        }
                        return n;
                    }

                    public static void main(String[] args) {
                        System.out.println(count(Arrays.asList(1, 2, 2, 5), new int[] {2, 3, 5, 2}));
                        System.out.println(count(null, new int[0]));
                        System.out.println(seen(new int[] {3, 1, 3}));
                        try {
                            count(null, new int[] {1});
                        } catch (NullPointerException e) {
                            System.out.println("npe");
                        }
                    }
                }
                """);
        String before = run(tmp.resolve("a"), original);
        assertEquals("3\n0\n2\nnpe\n", before.replace("\r\n", "\n"));
        Map<String, String> current = new LinkedHashMap<>(original);
        List<String> ids = issues(original);
        assertEquals(2, ids.size(), ids.toString());
        for (int i = 0; i < 2; i++) {
            String id = issues(current).get(0); // позиции сдвигаются после каждой правки (импорты, новая строка)
            QualityGate.Result r = new QualityGate(ctx -> new VerifyResult(VerifyResult.Status.GREEN, List.of(), List.of()))
                    .apply(original, current, "p.Main", fix, id);
            assertTrue(r.applied(), r.reason());
            current.putAll(r.changed());
        }
        assertEquals(List.of(), issues(current));
        assertEquals(before, run(tmp.resolve("b"), current));
    }

    private static String run(Path dir, Map<String, String> files) throws Exception {
        return exec(compile(dir, files), "p.Main", null);
    }

    private static Path compile(Path dir, Map<String, String> files) throws IOException {
        Path classes = dir.resolve("classes");
        List<String> args = new ArrayList<>(List.of("-d", classes.toString(), "-proc:none", "-encoding", "UTF-8"));
        for (var e : files.entrySet()) {
            Path f = dir.resolve("src").resolve(e.getKey());
            Files.createDirectories(f.getParent());
            Files.writeString(f, e.getValue());
            args.add(f.toString());
        }
        assertEquals(0, ToolProvider.getSystemJavaCompiler().run(null, null, null, args.toArray(String[]::new)));
        return classes;
    }

    private static String exec(Path classes, String main, Path stdin) throws Exception {
        String java = ProcessHandle.current().info().command().orElse("java");
        ProcessBuilder pb = new ProcessBuilder(java, "-cp", classes.toString(), main).redirectErrorStream(true);
        if (stdin != null) pb.redirectInput(stdin.toFile());
        Process p = pb.start();
        String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int code = p.waitFor();
        if (stdin == null) assertEquals(0, code, out); // demo на errors.in законно завершается кодом 2
        return out;
    }
}
