package blueprints.fixes;

import static org.junit.jupiter.api.Assertions.*;

import blueprints.analysis.MethodAnalysis;
import blueprints.analysis.ProjectAnalysis;
import blueprints.analysis.StringConcatInLoop;
import blueprints.model.Issue;
import blueprints.source.SourceFile;
import blueprints.testing.VerifyResult;
import java.io.File;
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

class StringBuilderFixTest {

    private static final String FILE = "src/p/A.java";
    private final StringBuilderFix fix = new StringBuilderFix();

    private static Map<String, String> project(String body) {
        Map<String, String> files = new LinkedHashMap<>();
        files.put(FILE, "package p;\nimport java.util.List;\nclass A {\n    String f;\n" + body + "}\n");
        return files;
    }

    /** id находок StringConcatInLoop — как их выдаёт детектор. */
    private static List<String> issues(Map<String, String> files) {
        List<SourceFile> src = new ArrayList<>();
        files.forEach((path, text) -> {
            if (!path.endsWith(".java") || path.startsWith("tests/")) return;
            String pkg = text.lines().filter(l -> l.startsWith("package ")).findFirst()
                    .map(l -> l.substring(8, l.indexOf(';')).trim()).orElse("");
            src.add(new SourceFile(path, pkg, text.getBytes(StandardCharsets.UTF_8)));
        });
        ProjectAnalysis p = ProjectAnalysis.of(src);
        List<String> out = new ArrayList<>();
        for (MethodAnalysis m : p.methods()) for (Issue i : new StringConcatInLoop().detect(m, p)) out.add(i.id());
        return out;
    }

    private static String only(Map<String, String> files) {
        List<String> ids = issues(files);
        assertEquals(1, ids.size(), ids.toString());
        return ids.get(0);
    }

    @Test
    void joinRewrittenOnlyInNeededRanges() {
        Map<String, String> files = project("""
                    String join(List<String> parts, String sep) {
                        String out = "";
                        for (int i = 0; i < parts.size(); i++) {
                            if (i > 0) {
                                out += sep;
                            }
                            out += parts.get(i);   // comment stays
                        }
                        return out;
                    }
                """);
        String id = only(files);
        assertTrue(fix.canApply(files, id));
        Map<String, String> r = fix.apply(files, id);
        assertEquals(project("""
                    String join(List<String> parts, String sep) {
                        String out = "";
                        StringBuilder outSb = new StringBuilder(out);
                        for (int i = 0; i < parts.size(); i++) {
                            if (i > 0) {
                                outSb.append(sep);
                            }
                            outSb.append(parts.get(i));   // comment stays
                        }
                        out = outSb.toString();
                        return out;
                    }
                """), r);
    }

    @Test
    void assignChainAndTwoVariablesAndCrlf() {
        Map<String, String> files = project("""
                    void g(List<String> xs) {
                        String a = "", b = "x" + 1;
                        b += "y";
                        for (String x : xs) {
                            a = a + x + 1 + 2;
                            b += 1 + 2;
                        }
                        System.out.println(a + b);
                    }
                """);
        files.replaceAll((k, v) -> v.replace("\n", "\r\n"));
        String out = fix.apply(files, only(files)).get(FILE);
        assertTrue(out.contains("""
                        StringBuilder aSb = new StringBuilder(a);
                        StringBuilder bSb = new StringBuilder(b);
                        for (String x : xs) {
                            aSb.append(x).append(1).append(2);
                            bSb.append(1 + 2);
                        }
                        a = aSb.toString();
                        b = bSb.toString();
                """.replace("\n", "\r\n")), out);
        assertFalse(out.replace("\r\n", "").contains("\n"), "перевод строки файла сохранён");
    }

    @Test
    void freshBuilderNameAvoidsCollision() {
        Map<String, String> files = project("""
                    String h(List<String> xs) {
                        String s = "";
                        int sSb = 0;
                        for (String x : xs) s += x;
                        return s + sSb;
                    }
                """);
        String out = fix.apply(files, only(files)).get(FILE);
        assertTrue(out.contains("StringBuilder sSb2 = new StringBuilder(s);\n        for (String x : xs) sSb2.append(x);\n        s = sSb2.toString();"), out);
    }

    @Test
    void unsafeShapesAreRejected() {
        List<String> bodies = List.of(
                // читается в цикле
                "String a(List<String> xs) { String s = \"\"; for (String x : xs) { if (s.length() > 3) break; s += x; } return s; }",
                // в заголовке цикла
                "String b(int n) { String s = \"\"; while (s.length() < n) s += \"x\"; return s; }",
                // s += s
                "String c(List<String> xs) { String s = \"a\"; for (String x : xs) s += s; return s; }",
                // поле
                "void d(List<String> xs) { for (String x : xs) f += x; }",
                // параметр
                "String e(String s, List<String> xs) { for (String x : xs) s += x; return s; }",
                // может быть null
                "String g(List<String> xs) { String s = null; for (String x : xs) s += x; return s; }",
                "String h(List<String> xs, String y) { String s = \"\"; s = y; for (String x : xs) s += x; return s; }",
                // try между объявлением и циклом
                "String i(List<String> xs) { String s = \"\"; try { for (String x : xs) s += x; } finally { System.out.println(s); } return s; }",
                // labeled break / метка
                "String j(List<List<String>> xs) { String s = \"\"; out: for (List<String> l : xs) for (String x : l) { if (x == null) break out; s += x; } return s; }",
                "String k(List<String> xs) { String s = \"\"; for (String x : xs) { s += x; if (x.isEmpty()) continue; } for (String x : xs) { inner: for (String y : xs) { s += y; break inner; } } return s; }",
                // значение присваивания используется
                "String l(List<String> xs) { String s = \"\"; for (String x : xs) System.out.println(s += x); return s; }",
                // char[] меняет смысл append
                "String m(List<char[]> xs) { String s = \"\"; for (char[] x : xs) s += x; return s; }",
                // тело цикла без блока у if
                "String o(List<String> xs, boolean z) { String s = \"\"; if (z) for (String x : xs) s += x; return s; }");
        for (String body : bodies) {
            Map<String, String> files = project(body + "\n");
            List<String> ids = issues(files);
            assertFalse(ids.isEmpty(), body);
            // k: первый цикл безопасен; второй (labeled) — нет
            List<String> check = body.startsWith("String k") ? ids.subList(1, ids.size()) : ids;
            for (String id : check) {
                assertFalse(fix.canApply(files, id), body);
                assertThrows(IllegalArgumentException.class, () -> fix.apply(files, id), body);
            }
        }
    }

    /** String + char[] = "[C@…", а append(char[]) — символы: тип слагаемого, который может быть char[], — отказ. */
    @Test
    void possibleCharArrayIsRejected() {
        String helpers = "char[] chars() { return new char[] {'a'}; } <T> T id(T t) { return t; } char[][] grid;\n";
        List<String> bodies = List.of(
                "String a(List<String> xs) { String s = \"\"; for (String x : xs) s += chars(); return s; }",
                "String b(List<String> xs) { String s = \"\"; for (String x : xs) s += x.toCharArray(); return s; }",
                "String c(List<String> xs) { String s = \"\"; for (String x : xs) s = s + 1 + x.toCharArray(); return s; }",
                "String d(List<char[]> xs) { String s = \"\"; for (int i = 0; i < xs.size(); i++) s += xs.get(i); return s; }",
                "String e(List<String> xs, char[] cs) { String s = \"\"; for (String x : xs) s += id(cs); return s; }",
                "String g(List<String> xs, char[] cs) { String s = \"\"; for (String x : xs) s += java.util.Objects.requireNonNull(cs); return s; }",
                "String h(List<String> xs, char[] cs) { String s = \"\"; for (String x : xs) s += (x.isEmpty() ? cs : cs); return s; }",
                "String i(List<String> xs) { String s = \"\"; for (String x : xs) s += grid[0]; return s; }",
                "String j(List<String> xs) { String s = \"\"; for (String x : xs) s += (char[]) null; return s; }",
                "String k(List<String> xs) { String s = \"\"; for (String x : xs) s += this.grid; return s; }",
                "String l(List<String> xs) { String s = \"\"; for (String x : xs) s += unknown(x); return s; }",
                "String m(List<String> xs) { String s = \"\"; xs.forEach(x -> {}); for (var x : xs.toArray()) s += x; return s; }");
        for (String body : bodies) {
            // цикл на своей строке: отказ только из-за типа слагаемого
            Map<String, String> files = project(helpers + body.replace(" for (", "\n for (") + "\n");
            String id = only(files);
            assertFalse(fix.canApply(files, id), body);
            if (!body.startsWith("String m")) {
                Map<String, String> control = project(helpers + body.replace(" for (", "\n for (").replaceAll("s (\\+)?= .*?; return", "s += \"x\"; return") + "\n");
                assertTrue(fix.canApply(control, only(control)), body);
            }
        }
    }

    @Test
    void knownNonArrayValuesAreAccepted() {
        String helpers = "int n() { return 1; } enum E { X } E e() { return E.X; }\n";
        List<String> bodies = List.of(
                "String a(List<String> xs) { String s = \"\"; for (String x : xs) s += n() + e().name(); return s; }",
                "String b(List<String> xs) { String s = \"\"; for (String x : xs) s += e(); return s; }",
                "String c(List<String> xs) { String s = \"\"; for (String x : xs) s += String.valueOf(x.toCharArray()); return s; }",
                "String d(List<String> xs) { String s = \"\"; for (int i = 0; i < xs.size(); i++) s += xs.get(i).trim(); return s; }",
                "String g(List<String> xs, char[] cs) { String s = \"\"; for (String x : xs) s += (Object) cs; return s; }",
                "String h(List<String> xs) { String s = \"\"; for (String x : xs) s += (x.isEmpty() ? 'c' : x); return s; }");
        for (String body : bodies) {
            // цикл — на своей строке
            Map<String, String> files = project(helpers + body.replace(" for (", "\n for (") + "\n");
            String id = only(files);
            assertTrue(fix.canApply(files, id), body);
        }
    }

    /** Комментарий перед слагаемым переносится в аргумент append; в другом месте присваивания — отказ (иначе пропал бы). */
    @Test
    void commentsInsideAssignmentAreKept() {
        Map<String, String> files = project("""
                    String c(List<String> xs) {
                        String s = "", t = "";
                        for (String x : xs) {
                            s += /*c*/ x;
                            t = t + /* a */ x + // b
                                1;
                        }
                        return s + t;
                    }
                """);
        String out = fix.apply(files, only(files)).get(FILE);
        assertTrue(out.contains("sSb.append(/*c*/ x);"), out);
        assertTrue(out.contains("tSb.append(/* a */ x).append(// b\n                1);"), out);
        for (String lost : List.of("s /*c*/ += x;", "s = /*c*/ s + x;", "s = s /*c*/ + x;")) {
            Map<String, String> bad = project("String d(List<String> xs) { String s = \"\";\n for (String x : xs) " + lost + " return s; }\n");
            assertFalse(fix.canApply(bad, only(bad)), lost);
            Map<String, String> control = project("String d(List<String> xs) { String s = \"\";\n for (String x : xs) s += x; return s; }\n");
            assertTrue(fix.canApply(control, only(control)));
        }
    }

    @Test
    void badTargetsAreRejected() {
        Map<String, String> files = project("String j(List<String> xs) {\n String s = \"\";\n for (String x : xs) s += x;\n return s;\n}\n");
        String id = only(files);
        assertTrue(fix.canApply(files, id));
        for (String t : List.of("", "x", "StringConcatInLoop:p.A.j~0:1:1", "StringConcatInLoop:p.A.nope~0:7:2",
                "StringConcatInLoop:p.A.j~0:a:b")) {
            assertFalse(fix.canApply(files, t), t);
        }
        assertFalse(fix.canApply(files, null));
    }

    @Test
    void registryKnowsFix() {
        assertSame(StringBuilderFix.class, RefactoringRegistry.defaults().byId("string-builder").getClass());
        assertNull(RefactoringRegistry.defaults().byId("nope"));
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

    @Test
    void demoJoinAndFullReportCompileAndKeepOutput(@TempDir Path tmp) throws Exception {
        Map<String, String> original = demo();
        Map<String, String> current = new LinkedHashMap<>(original);
        List<String> fixed = new ArrayList<>();
        for (String id : issues(original)) {
            if (!fix.canApply(current, id)) continue;
            // через Quality Gate (проверка поведения подменена — её делает прогон ниже)
            QualityGate.Result r = new QualityGate(ctx -> new VerifyResult(VerifyResult.Status.GREEN, List.of(), List.of()))
                    .apply(original, current, "com.demo.Main", fix, id);
            assertTrue(r.applied(), r.reason());
            current.putAll(r.changed());
            fixed.add(id.split(":")[1]);
        }
        assertEquals(List.of("com.demo.service.ReportService.fullReport~0", "com.demo.util.Texts.join~0"), fixed);
        assertEquals(List.of(), issues(current), "конкатенаций в циклах не осталось");
        current.forEach((path, text) -> {
            if (!path.endsWith("ReportService.java") && !path.endsWith("Texts.java")) assertEquals(original.get(path), text, path);
        });

        Path classes = tmp.resolve("classes");
        List<String> args = new ArrayList<>(List.of("-d", classes.toString(), "-proc:none"));
        for (var e : current.entrySet()) {
            Path f = tmp.resolve("src2").resolve(e.getKey());
            Files.createDirectories(f.getParent());
            Files.writeString(f, e.getValue());
            args.add(f.toString());
        }
        assertEquals(0, ToolProvider.getSystemJavaCompiler().run(null, null, null, args.toArray(String[]::new)));

        String java = ProcessHandle.current().info().command().orElse("java");
        try (Stream<Path> s = Files.list(DEMO.resolve("tests"))) {
            List<Path> ins = s.filter(x -> x.toString().endsWith(".in")).sorted().toList();
            assertFalse(ins.isEmpty());
            for (Path in : ins) {
                Process p = new ProcessBuilder(java, "-cp", classes.toString(), "com.demo.Main")
                        .redirectInput(in.toFile()).redirectErrorStream(true).start();
                String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                p.waitFor();
                String expected = Files.readString(Path.of(in.toString().replaceAll("\\.in$", ".out")));
                assertEquals(expected, out, in.getFileName() + File.separator);
            }
        }
    }
}
