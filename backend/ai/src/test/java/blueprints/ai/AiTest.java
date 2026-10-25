package blueprints.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.fixes.Refactoring;
import blueprints.model.Issue;
import blueprints.model.Span;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.Test;

class AiTest {
    static final String FILE = """
            package p;

            import java.util.List;

            class A {
                int keep(int x) {   return x;  }

                int sum(List<Integer> xs) {
                    int s = 0;
                    for (int x : xs) s += x;
                    return s;
                }

                void other() {}
            }
            """;

    /** Фейк: запоминает промпты, отдаёт заданный ответ. */
    static final class Fake implements LlmClient {
        final List<String> users = new ArrayList<>();
        String reply;

        Fake(String reply) {
            this.reply = reply;
        }

        @Override
        public String chat(String system, String user) {
            users.add(system + "\n" + user);
            return reply;
        }
    }

    static CallableDeclaration<?> sum(String text) {
        CompilationUnit cu = MethodPatch.parser().parse(text).getResult().orElseThrow();
        return cu.findFirst(MethodDeclaration.class, m -> m.getNameAsString().equals("sum")).orElseThrow();
    }

    @Test
    void editReplacesOnlyTheMethodAndAddsImports() {
        Fake llm = new Fake("""
                Вот:
                ```java
                import java.util.Objects;
                import java.util.List;

                int sum(List<Integer> xs) {
                    if (xs == null) return 0;
                    int s = 0;
                    for (int x : xs) s += x;
                    return s;
                }
                ```
                """);
        String out = new Ai(llm).edit(FILE, sum(FILE), null, "добавь проверку на null");
        assertTrue(out.contains("import java.util.List;\nimport java.util.Objects;\n"), out);
        assertEquals(1, out.split("import java.util.List;", -1).length - 1, out);
        assertTrue(out.contains("    int sum(List<Integer> xs) {\n        if (xs == null) return 0;\n"), out);
        assertTrue(out.contains("    int keep(int x) {   return x;  }\n"), out); // соседний метод байт в байт
        assertTrue(out.endsWith("        return s;\n    }\n\n    void other() {}\n}\n"), out);
        assertTrue(llm.users.get(0).contains("добавь проверку на null"));
        assertTrue(llm.users.get(0).contains("LinkedHashMap/LinkedHashSet"));
    }

    @Test
    void crlfIsKept() {
        String crlf = FILE.replace("\n", "\r\n");
        String out = new Ai(new Fake("int sum(List<Integer> xs) {\n    return 0;\n}")).edit(crlf, sum(crlf), "return s;", "верни 0");
        assertFalse(out.replace("\r\n", "").contains("\n"), out);
        assertTrue(out.contains("    int sum(List<Integer> xs) {\r\n        return 0;\r\n    }\r\n"), out);
    }

    @Test
    void notJavaIsBadReply() {
        assertThrows(MethodPatch.BadReply.class, () -> new Ai(new Fake("не знаю")).edit(FILE, sum(FILE), null, "x"));
        assertThrows(MethodPatch.BadReply.class, () -> new Ai(new Fake("```java\nint x = 1;\n```")).edit(FILE, sum(FILE), null, "x"));
    }

    @Test
    void fixWithPrivateHelperInsertsItAfterMethodAndCompiles() throws Exception {
        Fake llm = new Fake("""
                Исправил:
                ```java
                int sum(List<Integer> xs) {
                    return total(xs);
                }

                private static int total(List<Integer> xs) {
                    int s = 0;
                    for (int x : xs) s += x;
                    return s;
                }
                ```
                Готово, вспомогательный метод вынесен.""");
        String out = new Ai(llm).proposeFix(ISSUE, "A.java", FILE, sum(FILE)).apply(Map.of("A.java", FILE), ISSUE.id()).get("A.java");
        String body = "        int s = 0;\n        for (int x : xs) s += x;\n        return s;\n    }\n";
        assertEquals(FILE.replace(body, "        return total(xs);\n    }\n\n"
                + "    private static int total(List<Integer> xs) {\n" + body), out);
        assertTrue(llm.users.get(0).contains("ровно один метод"));
        Path dir = Files.createTempDirectory("ai").resolve("p");
        Files.createDirectories(dir);
        Path src = Files.writeString(dir.resolve("A.java"), out);
        assertEquals(0, ToolProvider.getSystemJavaCompiler().run(null, null, null, "-d", dir.getParent().toString(), src.toString()));
    }

    @Test
    void wholeClassReplyTakesOnlyTheMethod() {
        String out = new Ai(new Fake("""
                ```java
                package p;

                import java.util.List;
                import java.util.Objects;

                class A {
                    int keep(int x) { return x; }

                    int sum(List<Integer> xs) {
                        return Objects.requireNonNull(xs).size();
                    }

                    void other() {}
                }
                ```""")).edit(FILE, sum(FILE), null, "x");
        assertEquals(FILE.replace("import java.util.List;\n", "import java.util.List;\nimport java.util.Objects;\n")
                .replace("        int s = 0;\n        for (int x : xs) s += x;\n        return s;\n",
                        "        return Objects.requireNonNull(xs).size();\n"), out);
    }

    @Test
    void rewritingNeighbourMethodIsRejected() {
        MethodPatch.BadReply e = assertThrows(MethodPatch.BadReply.class, () -> new Ai(new Fake("""
                ```java
                int sum(List<Integer> xs) { return 0; }

                void other() { System.out.println(); }
                ```""")).edit(FILE, sum(FILE), null, "x"));
        assertTrue(e.getMessage().contains("ИИ изменил другой метод other"), e.getMessage());
    }

    @Test
    void replyWithoutTheMethodIsRejected() {
        MethodPatch.BadReply e = assertThrows(MethodPatch.BadReply.class,
                () -> new Ai(new Fake("```java\nint total() { return 1; }\n```")).edit(FILE, sum(FILE), null, "x"));
        assertEquals("ответ ИИ не содержит метод sum", e.getMessage());
    }

    static final String WITH_INIT = """
            package p;

            import java.util.HashMap;
            import java.util.List;

            class A {
                static int n;
                static { n = 1; }
                java.util.Map<Integer, Integer> m = new HashMap<>();

                int sum(List<Integer> xs) {
                    int s = 0;
                    for (int x : xs) s += x;
                    return s;
                }
            }
            """;

    static String wholeClass(String init, String sum) {
        return "```java\npackage p;\n\nimport java.util.HashMap;\nimport java.util.List;\n\nclass A {\n    static int n;\n    "
                + init + "\n    java.util.Map<Integer, Integer> m = new HashMap<>();\n\n    " + sum + "\n}\n```";
    }

    @Test
    void unchangedHashMapNeighboursDoNotCountAndInitializerIsNotDuplicated() {
        String reply = wholeClass("static { n = 1; }", "int sum(List<Integer> xs) { return xs.size(); }");
        Refactoring fix = new Ai(new Fake(reply)).proposeFix(ISSUE, "A.java", WITH_INIT, sum(WITH_INIT));
        String out = fix.apply(Map.of("A.java", WITH_INIT), ISSUE.id()).get("A.java");
        assertTrue(out.contains("    int sum(List<Integer> xs) { return xs.size(); }\n}\n"), out);
        assertEquals(1, out.split("static \\{ n = 1; }", -1).length - 1, out);
    }

    @Test
    void newInitializerIsRejected() {
        String reply = wholeClass("static { n = 2; }", "int sum(List<Integer> xs) { return xs.size(); }");
        MethodPatch.BadReply e = assertThrows(MethodPatch.BadReply.class,
                () -> new Ai(new Fake(reply)).edit(WITH_INIT, sum(WITH_INIT), null, "x"));
        assertTrue(e.getMessage().contains("блок инициализации"), e.getMessage());
    }

    @Test
    void changedArityIsRejected() {
        MethodPatch.BadReply e = assertThrows(MethodPatch.BadReply.class, () -> new Ai(new Fake(
                "```java\nint sum(List<Integer> xs, int k) { return k; }\n```")).edit(FILE, sum(FILE), null, "x"));
        assertTrue(e.getMessage().contains("число параметров метода sum"), e.getMessage());
    }

    @Test
    void withoutClientUnavailable() {
        Ai off = new Ai(null);
        assertFalse(off.available());
        assertTrue(off.fixProviders().isEmpty());
        assertThrows(LlmClient.Unavailable.class, () -> off.explain(FILE, sum(FILE)));
    }

    @Test
    void explainSendsMethodText() {
        Fake llm = new Fake("**Что делает.** суммирует");
        assertEquals("**Что делает.** суммирует", new Ai(llm).explain(FILE, sum(FILE)));
        assertTrue(llm.users.get(0).contains("for (int x : xs) s += x;"));
    }

    static final Issue ISSUE = new Issue("R:p.A.sum~0:9:9", "R", "low", "high", "blueprints", new Span("A.java", 9, 9),
            "p.A.sum~0", null, "медленно", null, null, List.of());

    @Test
    void fixWithHashMapIsRejected() {
        Fake llm = new Fake("""
                ```java
                int sum(List<Integer> xs) {
                    java.util.Map<Integer, Integer> m = new java.util.HashMap<>();
                    return 0;
                }
                ```""");
        Ai ai = new Ai(llm);
        assertEquals(LlmFixProvider.ID, ai.fixProviders().get(0).id());
        Refactoring fix = ai.proposeFix(ISSUE, "A.java", FILE, sum(FILE));
        Map<String, String> files = Map.of("A.java", FILE);
        assertTrue(fix.canApply(files, ISSUE.id()));
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> fix.apply(files, ISSUE.id()));
        assertEquals(LlmFixProvider.ORDER_VIOLATION, e.getMessage());
        assertTrue(llm.users.get(0).contains("медленно") && llm.users.get(0).contains("LinkedHashMap/LinkedHashSet"));
    }

    @Test
    void fixWithLinkedHashMapApplies() {
        Fake llm = new Fake("""
                ```java
                import java.util.LinkedHashMap;
                int sum(List<Integer> xs) {
                    var m = new LinkedHashMap<Integer, Integer>();
                    return xs.stream().mapToInt(Integer::intValue).sum();
                }
                ```""");
        Refactoring fix = new Ai(llm).proposeFix(ISSUE, "A.java", FILE, sum(FILE));
        assertFalse(fix.canApply(Map.of("A.java", FILE + " "), ISSUE.id())); // файл изменился после запроса
        String out = fix.apply(Map.of("A.java", FILE), ISSUE.id()).get("A.java");
        assertTrue(out.contains("import java.util.LinkedHashMap;") && out.contains("mapToInt"), out);
    }

    @Test
    void unchangedFixIsRejected() {
        String same = "```java\n" + MethodPatch.slice(FILE, sum(FILE)) + "\n```";
        Refactoring fix = new Ai(new Fake(same)).proposeFix(ISSUE, "A.java", FILE, sum(FILE));
        assertThrows(IllegalStateException.class, () -> fix.apply(Map.of("A.java", FILE), ISSUE.id()));
    }
}
