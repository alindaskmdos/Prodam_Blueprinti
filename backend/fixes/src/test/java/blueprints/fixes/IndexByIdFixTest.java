package blueprints.fixes;

import static org.junit.jupiter.api.Assertions.*;

import blueprints.analysis.MethodAnalysis;
import blueprints.analysis.NestedLoopSameCollection;
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

class IndexByIdFixTest {

    private final IndexByIdFix fix = new IndexByIdFix();

    private static final String ITEM = """
            package p;

            import java.util.ArrayList;
            import java.util.List;

            public class Item {
                private final int id;
                private final int key;
                private int soft;
                private Integer boxed;
                private final List<Line> lines = new ArrayList<>();
                private final List<StringBuilder> bad = new ArrayList<>();
                private St st = St.NEW;
                private String note = "";
                static int created;

                public Item(int id, int key) {
                    this.id = id;
                    this.key = key;
                    this.soft = key;
                    this.boxed = key;
                }

                public int getId() { return id; }
                public int getKey() { return key; }
                public int getSoft() { return soft; }
                public Integer getBoxed() { return boxed; }
                public List<Line> getLines() { return lines; }
                public List<StringBuilder> getBad() { return bad; }
                public St getSt() { return st; }
                public void setSt(St st) { this.st = st; }
                public void setNote(String note) { this.note = note; }
                public String getNote() { return note; }
                public void addLine(Line l) { lines.add(l); }
                public void count() { created++; }
            }
            """;

    private static Map<String, String> project(String extraItemMembers, String svcBody) {
        Map<String, String> files = new LinkedHashMap<>();
        files.put("src/p/Item.java", ITEM.replace("    public void count()", extraItemMembers + "    public void count()"));
        files.put("src/p/St.java", """
                package p;

                public enum St {
                    NEW, DONE, MERGED;

                    public boolean live() {
                        return this == NEW || !(this != DONE);
                    }
                }
                """);
        files.put("src/p/Line.java", """
                package p;

                public record Line(int product, int qty) {
                    public Line plus(Line o) {
                        return new Line(product, qty + o.qty);
                    }
                }
                """);
        files.put("src/p/Svc.java", """
                package p;

                import java.util.ArrayList;
                import java.util.List;

                public class Svc {
                    private final List<Item> items = new ArrayList<>();
                    private final List<String> log = new ArrayList<>();

                """ + svcBody + "}\n");
        return files;
    }

    private static String merge(String body) {
        return merge("int merged = 0;", "if (!a.getSt().live()) {\n                continue;\n            }",
                "j = i + 1", "b.getSt().live() && a.getKey() == b.getKey()", body);
    }

    private static String merge(String pre, String guard, String jInit, String cond, String body) {
        return """
                    public int merge() {
                        %s
                        for (int i = 0; i < items.size(); i++) {
                            Item a = items.get(i);
                            %s
                            for (int %s; j < items.size(); j++) {
                                Item b = items.get(j);
                                if (%s) {
                %s
                                }
                            }
                        }
                        return merged;
                    }

                    private void absorb(Item target, Item source) {
                        for (Line incoming : source.getLines()) {
                            boolean found = false;
                            List<Line> mine = target.getLines();
                            for (int k = 0; k < mine.size(); k++) {
                                if (mine.get(k).product() == incoming.product()) {
                                    mine.set(k, mine.get(k).plus(incoming));
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) {
                                target.addLine(incoming);
                            }
                        }
                    }
                """.formatted(pre, guard, jInit, cond, body.indent(20).stripTrailing());
    }

    private static final String GOOD = """
            absorb(a, b);
            b.setSt(St.MERGED);
            // keep me
            b.setNote("merged into " + a.getId());
            merged++;""";

    private static List<String> issues(Map<String, String> files) {
        ProjectAnalysis p = ProjectAnalysis.of(FixText.sources(files));
        List<String> out = new ArrayList<>();
        for (MethodAnalysis m : p.methods()) for (Issue i : new NestedLoopSameCollection().detect(m, p)) out.add(i.id());
        return out;
    }

    private static String mergeIssue(Map<String, String> files) {
        List<String> ids = issues(files).stream().filter(i -> i.contains(".merge~0:")).toList();
        assertEquals(1, ids.size(), ids.toString());
        return ids.get(0);
    }

    @Test
    void rewritesOnlyTheLoopWithLinkedHashMap() {
        Map<String, String> files = project("", merge(GOOD));
        String id = mergeIssue(files);
        assertTrue(fix.canApply(files, id));
        Map<String, String> r = fix.apply(files, id);
        assertEquals(List.of("src/p/Svc.java"), List.copyOf(r.keySet()));
        String expected = files.get("src/p/Svc.java")
                .replace("import java.util.List;\n", "import java.util.List;\nimport java.util.LinkedHashMap;\nimport java.util.Map;\n")
                .replace("""
                        int merged = 0;
                                for (int i = 0; i < items.size(); i++) {
                                    Item a = items.get(i);
                                    if (!a.getSt().live()) {
                                        continue;
                                    }
                                    for (int j = i + 1; j < items.size(); j++) {
                                        Item b = items.get(j);
                                        if (b.getSt().live() && a.getKey() == b.getKey()) {
                                            absorb(a, b);
                                            b.setSt(St.MERGED);
                                            // keep me
                                            b.setNote("merged into " + a.getId());
                                            merged++;
                                        }
                                    }
                                }
                        """, """
                        int merged = 0;
                                Map<Integer, Item> byKey = new LinkedHashMap<>();
                                for (int i = 0; i < items.size(); i++) {
                                    Item b = items.get(i);
                                    if (!b.getSt().live()) {
                                        continue;
                                    }
                                    Item a = byKey.putIfAbsent(b.getKey(), b);
                                    if (a != null) {
                                        absorb(a, b);
                                        b.setSt(St.MERGED);
                                        // keep me
                                        b.setNote("merged into " + a.getId());
                                        merged++;
                                    }
                                }
                        """);
        assertNotEquals(files.get("src/p/Svc.java"), expected, "шаблон теста совпал с исходником");
        assertEquals(expected, r.get("src/p/Svc.java"));
        assertTrue(issues(r).stream().noneMatch(i -> i.contains(".merge~0:")), "вложенного цикла не осталось");
    }

    @Test
    void crlfAndExistingImports() {
        Map<String, String> files = project("", merge(GOOD));
        files.replaceAll((k, v) -> v.replace("import java.util.List;\n", "import java.util.*;\n").replace("\n", "\r\n"));
        String out = fix.apply(files, mergeIssue(files)).get("src/p/Svc.java");
        assertFalse(out.replace("\r\n", "").contains("\n"), "перевод строки файла сохранён");
        assertFalse(out.contains("import java.util.Map;"));
        assertTrue(out.contains("Item a = byKey.putIfAbsent(b.getKey(), b);\r\n            if (a != null) {\r\n                absorb(a, b);"), out);
    }

    @Test
    void unsafeShapesAreRejected() {
        Map<String, String> bodies = new LinkedHashMap<>();
        bodies.put("break — берётся только первое совпадение", GOOD + "\nbreak;");
        bodies.put("b не становится мёртвым", "absorb(a, b);\nmerged++;");
        bodies.put("b остаётся живым", "absorb(a, b);\nb.setSt(St.NEW);");
        bodies.put("смерть b только по условию", "if (merged > 0) b.setSt(St.MERGED);\nmerged++;");
        bodies.put("статус a меняется", GOOD + "\na.setSt(St.DONE);");
        bodies.put("поле владельца", GOOD + "\nlog.add(\"x\");");
        bodies.put("список меняется", GOOD + "\nitems.remove(b);");
        bodies.put("счётчик читается в цикле", "b.setSt(St.MERGED);\nb.setNote(\"#\" + merged);\nmerged++;");
        bodies.put("индексы", "b.setSt(St.MERGED);\nb.setNote(\"\" + j);");
        bodies.put("лямбда", "b.setSt(St.MERGED);\nRunnable r = () -> absorb(a, b);");
        bodies.put("throw", "b.setSt(St.MERGED);\nthrow new IllegalStateException();");
        bodies.put("return", "b.setSt(St.MERGED);\nreturn merged;");
        bodies.put("static-поле элемента", "b.setSt(St.MERGED);\nb.count();");
        bodies.put("изменяемые элементы коллекции", "b.setSt(St.MERGED);\na.getBad().add(new StringBuilder());");
        bodies.put("элемент в коллекцию/поле", "b.setSt(St.MERGED);\nb.setNote(a.toString());");
        bodies.put("static-вызов", "b.setSt(St.MERGED);\nSystem.out.println(a.getId());");
        for (var e : bodies.entrySet()) assertRejected(project("", merge(e.getValue())), e.getKey());

        assertRejected(project("", merge("int merged = 0;", "if (!a.getSt().live()) continue;", "j = 0",
                "b.getSt().live() && a.getKey() == b.getKey()", GOOD)), "j = 0");
        assertRejected(project("", merge("int merged = 0;", "if (a.getSt().live()) continue;", "j = i + 1",
                "b.getSt().live() && a.getKey() == b.getKey()", GOOD)), "охранник не тот");
        assertRejected(project("", merge("int merged = 0;", "", "j = i + 1",
                "b.getSt().live() && a.getKey() == b.getKey()", GOOD)), "нет охранника");
        assertRejected(project("", merge("int merged = 0;", "if (!a.getSt().live()) continue;", "j = i + 1",
                "b.getSt().live() && a.getSoft() == b.getSoft()", GOOD)), "ключ не final");
        assertRejected(project("", merge("int merged = 0;", "if (!a.getSt().live()) continue;", "j = i + 1",
                "b.getSt().live() && a.getBoxed() == b.getBoxed()", GOOD)), "Integer == сравнивает ссылки");
        assertRejected(project("", merge("int merged = 0;", "if (!a.getSt().live()) continue;", "j = i + 1",
                "b.getSt().live() && a.getKey() != b.getKey()", GOOD)), "не равенство");
        assertRejected(project("", merge("double merged = 0;", "if (!a.getSt().live()) continue;", "j = i + 1",
                "b.getSt().live() && a.getKey() == b.getKey()", GOOD)), "счётчик double");
        // DONE тоже живой по live(): this != DONE ложно → !(…) истинно
        assertRejected(project("", merge(GOOD.replace("St.MERGED", "St.DONE"))), "DONE живой");
        // public absorb может быть переопределён / вызывает чужой код
        Map<String, String> pub = project("", merge(GOOD));
        pub.put("src/p/Svc.java", pub.get("src/p/Svc.java").replace("private void absorb", "public void absorb"));
        assertRejected(pub, "public absorb");
        // у Item есть наследник — вызовы виртуальные
        Map<String, String> sub = project("", merge(GOOD));
        sub.put("src/p/Sub.java", "package p;\n\npublic class Sub extends Item {\n    Sub() { super(0, 0); }\n}\n");
        assertRejected(sub, "наследник");
        // тип возврата геттера ключа не совпадает с полем
        String getters = "    public Integer getIdBoxed() { return id; }\n    public long getIdLong() { return id; }\n";
        assertRejected(project(getters, merge("int merged = 0;", "if (!a.getSt().live()) continue;", "j = i + 1",
                "b.getSt().live() && a.getIdBoxed() == b.getIdBoxed()", GOOD)), "Integer-геттер над int: == по ссылкам");
        assertRejected(project(getters, merge("int merged = 0;", "if (!a.getSt().live()) continue;", "j = i + 1",
                "b.getSt().live() && a.getIdLong() == b.getIdLong()", GOOD)), "long-геттер над int");
        // анонимный подкласс Item где-то в проекте
        Map<String, String> anon = project("", merge(GOOD));
        anon.put("src/p/Anon.java", "package p;\n\nclass Anon {\n    Item x = new Item(0, 0) {\n        @Override public int getKey() { return 1; }\n    };\n}\n");
        assertRejected(anon, "анонимный подкласс");
        // наследник Item с переопределённым геттером только в tests/ (JUnit)
        Map<String, String> inTests = project("", merge(GOOD));
        inTests.put("tests/X.java", "package p;\n\nclass X extends Item {\n    X() { super(0, 0); }\n    @Override public int getKey() { return 7; }\n}\n");
        assertRejected(inTests, "наследник в tests/");
        // свой тип с именем List в проекте
        Map<String, String> own = project("", merge(GOOD));
        own.put("src/q/List.java", "package q;\n\npublic class List {\n}\n");
        assertRejected(own, "свой List");
        // сеттер с побочным эффектом
        Map<String, String> side = project("    public void touch() { note = note + \"!\"; created = 1; }\n",
                merge("b.setSt(St.MERGED);\nb.touch();"));
        assertRejected(side, "static-поле в методе элемента");
        // toString record'а в конкатенации уходит в код проекта
        Map<String, String> ts = project("", merge("b.setSt(St.MERGED);\nb.setNote(\"\" + b.getLines().get(0));"));
        assertTrue(fix.canApply(ts, mergeIssue(ts)), "неявный toString record'а чистый");
        ts.put("src/p/Line.java", ts.get("src/p/Line.java").replace("    public Line plus",
                "    @Override public String toString() { return \"L\"; }\n    public Line plus"));
        assertRejected(ts, "свой toString");
    }

    private void assertRejected(Map<String, String> files, String why) {
        List<String> ids = issues(files).stream().filter(i -> i.contains(".merge~0:")).toList();
        assertFalse(ids.isEmpty(), why);
        for (String id : ids) {
            assertFalse(fix.canApply(files, id), why);
            assertThrows(IllegalArgumentException.class, () -> fix.apply(files, id), why);
        }
    }

    @Test
    void badTargetsAreRejected() {
        Map<String, String> files = project("", merge(GOOD));
        String id = mergeIssue(files);
        for (String t : List.of("", "x", "NestedLoopSameCollection:p.Svc.merge~0:1:1", "NestedLoopSameCollection:p.Svc.nope~0:12:13",
                "NestedLoopSameCollection:p.Svc.merge~0:a:b", id.replace("NestedLoopSameCollection", "LinearSearchInLoop"))) {
            assertFalse(fix.canApply(files, t), t);
        }
        assertFalse(fix.canApply(files, null));
    }

    @Test
    void registryKnowsFix() {
        assertSame(IndexByIdFix.class, RefactoringRegistry.defaults().byId("index-by-id").getClass());
    }

    /** Поведение до и после фикса совпадает на данных с повторами ключей, разными ключами вперемешку и мёртвыми элементами. */
    @Test
    void programKeepsOutput(@TempDir Path tmp) throws Exception {
        Map<String, String> files = project("", merge(GOOD));
        files.put("src/p/Main.java", """
                package p;

                public class Main {
                    public static void main(String[] args) {
                        Svc s = new Svc();
                        int[][] data = {{1, 1}, {2, 2}, {3, 1}, {4, 3}, {5, 2}, {6, 1}, {7, 3}, {8, 4}};
                        for (int[] d : data) {
                            Item it = new Item(d[0], d[1]);
                            it.addLine(new Line(d[0] % 3, d[0]));
                            if (d[0] == 3) it.setSt(St.MERGED);
                            s.add(it);
                        }
                        System.out.println(s.merge());
                        for (Item it : s.all()) System.out.println(it.getId() + " " + it.getSt() + " " + it.getNote() + " " + it.getLines());
                    }
                }
                """);
        files.put("src/p/Svc.java", files.get("src/p/Svc.java").replace("    public int merge()",
                "    public void add(Item i) { items.add(i); }\n\n    public List<Item> all() { return items; }\n\n    public int merge()"));
        String before = run(tmp.resolve("a"), files);
        assertTrue(before.startsWith("3"), before);
        int[] verified = {0};
        QualityGate.Result r = new QualityGate(ctx -> {
            verified[0]++;
            return new VerifyResult(VerifyResult.Status.GREEN, List.of(), List.of());
        }).apply(files, files, "p.Main", fix, mergeIssue(files));
        assertTrue(r.applied(), r.reason());
        Map<String, String> after = new LinkedHashMap<>(files);
        after.putAll(r.changed());
        assertEquals(before, run(tmp.resolve("b"), after));
    }

    // ---- samples/demo ----

    private static final Path DEMO = Path.of("../../samples/demo");
    private static final String MERGE = "com.demo.service.OrderService.merge~0";

    private static Map<String, String> demo() throws IOException {
        Map<String, String> files = new LinkedHashMap<>();
        try (Stream<Path> s = Files.walk(DEMO.resolve("src"))) {
            for (Path f : s.filter(x -> x.toString().endsWith(".java")).sorted().toList()) {
                files.put(DEMO.relativize(f).toString().replace('\\', '/'), Files.readString(f));
            }
        }
        return files;
    }

    @Test
    void demoOnlyMergeAndIssueOffersFix() throws IOException {
        Map<String, String> files = demo();
        List<String> ids = issues(files);
        assertFalse(ids.isEmpty());
        for (String id : ids) assertEquals(id.contains(":" + MERGE + ":"), fix.canApply(files, id), id);
        // Issue.fixes, как его собирает app: только high и canApply по реестру
        ProjectAnalysis p = ProjectAnalysis.of(FixText.sources(files));
        Issue issue = new NestedLoopSameCollection().detect(p.method(MERGE), p).get(0);
        assertEquals("high", issue.confidence());
        List<String> fixes = RefactoringRegistry.defaults().refactorings().stream()
                .filter(r -> r.canApply(files, issue.id())).map(Refactoring::id).toList();
        assertEquals(List.of("index-by-id"), fixes);
    }

    /** Фикс на demo через QualityGate: компиляция и реальный прогон tests/*.in, вывод совпадает с .out. */
    @Test
    void demoMergeFixKeepsIoTestsGreen(@TempDir Path tmp) throws Exception {
        Map<String, String> original = demo();
        String id = issues(original).stream().filter(i -> i.contains(":" + MERGE + ":")).findFirst().orElseThrow();
        int[] runs = {0};
        QualityGate.Result r = new QualityGate(ctx -> {
            try {
                Path classes = compile(tmp.resolve("run" + runs[0]++), ctx.currentFiles());
                List<Path> ins;
                try (Stream<Path> s = Files.list(DEMO.resolve("tests"))) {
                    ins = s.filter(x -> x.toString().endsWith(".in")).sorted().toList();
                }
                assertFalse(ins.isEmpty());
                for (Path in : ins) {
                    Path out = in.resolveSibling(in.getFileName().toString().replace(".in", ".out"));
                    if (!exec(classes, "com.demo.Main", in).equals(Files.readString(out))) {
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
        assertEquals(java.util.Set.of("src/com/demo/service/OrderService.java"), r.changed().keySet());
        String patched = r.changed().get("src/com/demo/service/OrderService.java");
        assertTrue(patched.contains("Map<Integer, Order> byCustomer = new LinkedHashMap<>();"), patched);
        assertTrue(patched.contains("Order a = byCustomer.putIfAbsent(b.getCustomerId(), b);"), patched);
        Map<String, String> after = new LinkedHashMap<>(original);
        after.putAll(r.changed());
        assertTrue(issues(after).stream().noneMatch(i -> i.contains(":" + MERGE + ":")), "вложенного цикла в merge не осталось");
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
        if (stdin == null) assertEquals(0, code, out);
        return out;
    }
}
