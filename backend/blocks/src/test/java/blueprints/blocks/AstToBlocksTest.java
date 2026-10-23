package blueprints.blocks;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Block;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.github.javaparser.ParseProblemException;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.comments.Comment;
import com.github.javaparser.ast.stmt.BlockStmt;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class AstToBlocksTest {
    static final ObjectMapper M = new ObjectMapper();

    static {
        StaticJavaParser.getParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21);
    }

    /** Метод m класса T с данным телом. */
    static Block body(String code) {
        return parse("class T { void m(int x, java.util.List<String> xs) {\n" + code + "\n} }");
    }

    static Block parse(String src) {
        CompilationUnit cu = StaticJavaParser.parse(src);
        CallableDeclaration<?> d = cu.findFirst(CallableDeclaration.class).orElseThrow();
        Block b = AstToBlocks.convert(d, "T.m~0", "T.java");
        assertNoCommentLost(d, b);
        return b;
    }

    static List<Block> top(Block m) {
        return m.slots().get("body");
    }

    static List<Block> all(Block b) {
        List<Block> out = new ArrayList<>(List.of(b));
        b.slots().values().forEach(l -> l.forEach(c -> out.addAll(all(c))));
        return out;
    }

    /**
     * Каждый комментарий тела попадает в дерево ровно столько раз, сколько он есть в исходнике:
     * блоком comment (по тексту) или дословно в тексте поля (выражение, raw).
     */
    static void assertNoCommentLost(CallableDeclaration<?> d, Block root) {
        BlockStmt body = d instanceof MethodDeclaration m ? m.getBody().orElse(null) : ((ConstructorDeclaration) d).getBody();
        if (body == null) return;
        List<Block> blocks = all(root).stream().filter(b -> !b.kind().equals("method")).toList();
        String texts = blocks.stream().filter(b -> !b.kind().equals("comment"))
                .flatMap(b -> b.fields().values().stream()).collect(Collectors.joining("\n"));
        // JavaParser может вернуть один и тот же комментарий несколько раз — считаем по позиции
        Map<Object, Comment> unique = new java.util.HashMap<>();
        body.getAllContainedComments().forEach(c -> unique.putIfAbsent(c.getRange().orElseThrow(), c));
        Map<String, List<Comment>> byKey = unique.values().stream()
                .collect(Collectors.groupingBy(c -> c.getContent().strip()));
        byKey.forEach((key, cs) -> {
            long asBlocks = blocks.stream()
                    .filter(b -> b.kind().equals("comment") && b.fields().get("text").equals(key)).count();
            long inTexts = cs.stream().map(c -> c.getHeader() + c.getContent() + c.getFooter()).distinct()
                    .mapToLong(form -> Pattern.compile(Pattern.quote(form) + (form.startsWith("//") ? "(?=\\R|$)" : ""))
                            .matcher(texts).results().count())
                    .sum();
            assertEquals(cs.size(), asBlocks + inTexts,
                    () -> "комментарий '" + key + "' в " + d.getNameAsString() + ": блоков " + asBlocks + ", в тексте " + inTexts);
        });
    }

    static void strip(JsonNode n) {
        if (n instanceof ObjectNode o) {
            o.remove("issues");
            o.remove("collapsed");
        }
        n.forEach(AstToBlocksTest::strip);
    }

    @Test
    void referenceMerge() throws Exception {
        Path demo = Path.of("../../samples/demo");
        String rel = "src/com/demo/service/OrderService.java";
        CompilationUnit cu = StaticJavaParser.parse(demo.resolve(rel));
        CallableDeclaration<?> merge = cu.findAll(MethodDeclaration.class).stream()
                .filter(m -> m.getNameAsString().equals("merge")).findFirst().orElseThrow();
        Block b = AstToBlocks.convert(merge, "com.demo.service.OrderService.merge~0", rel);
        JsonNode actual = M.valueToTree(b);
        JsonNode expected = M.readTree(Files.readString(Path.of("../../contract/fixtures/method-view.merge.json"))).get("root");
        strip(actual); // issues/collapsed ставит анализ и фронт, не AstToBlocks
        strip(expected);
        assertEquals(expected, actual);
    }

    @Test
    void methodSignatureAndIds() {
        Block m = body("int a = 1;");
        assertEquals("method", m.kind());
        assertEquals("void m(int x, java.util.List<String> xs)", m.fields().get("signature"));
        assertEquals("T.m~0/body/0", top(m).get(0).id());
    }

    @Test
    void signatureIsExactHeaderText() {
        Block m = parse("class T {\n  /** doc */\n  @Override public static <T> T m(int x) throws Exception { return null; } }");
        assertEquals("@Override public static <T> T m(int x) throws Exception", m.fields().get("signature"));
        Block c = parse("class T { @Deprecated protected T(int x) throws java.io.IOException { } }");
        assertEquals("@Deprecated protected T(int x) throws java.io.IOException", c.fields().get("signature"));
        Block a = parse("interface I { default void d() { } }");
        assertEquals("default void d()", a.fields().get("signature"));
    }

    @Test
    void varAssignExprReturn() {
        List<Block> b = top(body("int a = 1; int c; a += 2; x = a; foo(a); return;"));
        assertEquals("var", b.get(0).kind());
        assertEquals("{type=int, name=a, init=1}", b.get(0).fields().toString());
        assertEquals("{type=int, name=c}", b.get(1).fields().toString());
        assertEquals("{target=a, op=+=, value=2}", b.get(2).fields().toString());
        assertEquals("assign", b.get(3).kind());
        assertEquals("{text=foo(a)}", b.get(4).fields().toString());
        assertEquals("return", b.get(5).kind());
        assertEquals("{}", b.get(5).fields().toString());
    }

    @Test
    void modifiersAndAnnotationsArePrefixOfType() {
        List<Block> b = top(body("final int k = 1; final int code; @SuppressWarnings(\"x\") final var v = xs;"
                + " for (final String s : xs) { k++; }"
                + " try { } catch (final RuntimeException e) { }"));
        assertEquals("{type=final int, name=k, init=1}", b.get(0).fields().toString());
        assertEquals("{type=final int, name=code}", b.get(1).fields().toString());
        assertEquals("{type=@SuppressWarnings(\"x\") final var, name=v, init=xs}", b.get(2).fields().toString());
        assertEquals("foreach", b.get(3).kind());
        assertEquals("{type=final String, var=s, iterable=xs}", b.get(3).fields().toString());
        assertEquals(1, b.get(3).slots().get("body").size());
        assertEquals("{type=final RuntimeException, var=e}", b.get(4).slots().get("catches").get(0).fields().toString());
    }

    @Test
    void ifElseIf() {
        Block i = top(body("if (x > 0) a(); else if (x < 0) { b(); c(); } else d();")).get(0);
        assertEquals("{cond=x > 0}", i.fields().toString());
        assertEquals(1, i.slots().get("then").size());
        Block inner = i.slots().get("else").get(0);
        assertEquals("if", inner.kind());
        assertEquals("T.m~0/body/0/else/0", inner.id());
        assertEquals(2, inner.slots().get("then").size());
        assertEquals("T.m~0/body/0/else/0/else/0", inner.slots().get("else").get(0).id());
    }

    @Test
    void loops() {
        List<Block> b = top(body("while (x > 0) x--; do { x++; } while (x < 5);"
                + " for (int i = 0, j = 1; i < 3; i++, j++) {} for (;;) break;"
                + " for (String s : xs) continue;"));
        assertEquals("{cond=x > 0}", b.get(0).fields().toString());
        assertEquals("dowhile", b.get(1).kind());
        assertEquals("{cond=x < 5}", b.get(1).fields().toString());
        assertEquals("{init=int i = 0, j = 1, cond=i < 3, update=i++, j++}", b.get(2).fields().toString());
        assertEquals("{init=, cond=, update=}", b.get(3).fields().toString());
        assertEquals("{type=String, var=s, iterable=xs}", b.get(4).fields().toString());
        assertEquals("continue", b.get(4).slots().get("body").get(0).kind());
    }

    @Test
    void switchCases() {
        Block s = top(body("switch (x) { case 1: case 2, 3: a(); break; default: b(); }")).get(0);
        List<Block> cases = s.slots().get("cases");
        assertEquals("{selector=x}", s.fields().toString());
        assertEquals("{label=1}", cases.get(0).fields().toString());
        assertEquals(0, cases.get(0).slots().get("body").size());
        assertEquals("{label=2, 3}", cases.get(1).fields().toString());
        assertEquals("T.m~0/body/0/cases/1/body/1", cases.get(1).slots().get("body").get(1).id());
        assertEquals("{label=default}", cases.get(2).fields().toString());
    }

    @Test
    void arrowSwitch() {
        Block s = top(body("switch (x) {\n case 1, 2 -> a();\n case 3 -> { b(); c(); }\n"
                + " case 4 -> throw new IllegalStateException();\n default -> { }\n}")).get(0);
        assertEquals("switch", s.kind());
        List<Block> cases = s.slots().get("cases");
        assertEquals("{label=1, 2, arrow=true}", cases.get(0).fields().toString());
        assertEquals("{text=a()}", cases.get(0).slots().get("body").get(0).fields().toString());
        assertEquals("expr", cases.get(0).slots().get("body").get(0).kind());
        assertEquals(List.of("expr", "expr"), cases.get(1).slots().get("body").stream().map(Block::kind).toList());
        assertEquals("T.m~0/body/0/cases/1/body/1", cases.get(1).slots().get("body").get(1).id());
        assertEquals("throw", cases.get(2).slots().get("body").get(0).kind());
        assertEquals("{label=default, arrow=true}", cases.get(3).fields().toString());
        assertEquals(0, cases.get(3).slots().get("body").size());
    }

    @Test
    void arrowAssignIsExpr() {
        Block c = top(body("switch (x) { case 1 -> x = 5; default -> x++; }")).get(0).slots().get("cases").get(0);
        assertEquals("{text=x = 5}", c.slots().get("body").get(0).fields().toString());
        assertEquals("expr", c.slots().get("body").get(0).kind());
    }

    @Test
    void patternSwitchWithGuard() {
        Block s = parse("class T { sealed interface S permits C, Q {} record C(int r) implements S {}"
                + " record Q(int a, int b) implements S {}\n void m(Object o) {"
                + " switch (o) { case C c when c.r() > 0 -> a(); case Q(int a, int b) -> b(); case null, default -> d(); } } }");
        Block sw = top(s).get(0);
        assertEquals("switch", sw.kind());
        List<Block> cases = sw.slots().get("cases");
        assertEquals("C c when c.r() > 0", cases.get(0).fields().get("label"));
        assertEquals("Q(int a, int b)", cases.get(1).fields().get("label"));
        assertEquals("null, default", cases.get(2).fields().get("label"));
    }

    @Test
    void switchExpressionStaysText() {
        Block v = top(body("int y = switch (x) { case 1 -> 2; default -> { yield 3; } };")).get(0);
        assertEquals("var", v.kind());
        assertEquals("switch (x) { case 1 -> 2; default -> { yield 3; } }", v.fields().get("init"));
    }

    @Test
    void expressionTextIsExactSource() {
        List<Block> b = top(body("foo(a,b);\nint y = list\n    .size();"));
        assertEquals("foo(a,b)", b.get(0).fields().get("text"));
        assertEquals("list\n    .size()", b.get(1).fields().get("init"));
    }

    /** Комментарии внутри выражений остаются в тексте ровно один раз (строгость — в assertNoCommentLost). */
    @Test
    void commentsInsideExpressions() {
        List<Block> b = top(body("foo(x /* c1 */);\nfoo(/* c2 */);\nRunnable r = () -> /* c3 */ foo();\n"
                + "Object o = new Object() { /* c4 */ };\nfoo(x, z // c5\n);\nint /* h */ y = 1;"));
        assertEquals("foo(x /* c1 */)", b.get(0).fields().get("text"));
        assertEquals("foo(/* c2 */)", b.get(1).fields().get("text"));
        assertEquals("() -> /* c3 */ foo()", b.get(2).fields().get("init"));
        assertEquals("new Object() { /* c4 */ }", b.get(3).fields().get("init"));
        assertEquals("foo(x, z // c5\n)", b.get(4).fields().get("text"));
        assertEquals("h", b.get(5).fields().get("text")); // в имени переменной — блоком перед оператором
        assertEquals("{type=int, name=y, init=1}", b.get(6).fields().toString());
        assertEquals(7, b.size());
    }

    @Test
    void lostCommentIsDetected() {
        Block fake = new Block("T.m~0", "method", Map.of(), Map.of("body",
                List.of(new Block("T.m~0/body/0", "expr", Map.of("text", "Runnable le = null"), Map.of(), null))), null);
        CallableDeclaration<?> d = StaticJavaParser.parse("class T { void m() { /* le */ Runnable le = null; } }")
                .findFirst(CallableDeclaration.class).orElseThrow();
        assertThrows(AssertionError.class, () -> assertNoCommentLost(d, fake));
    }

    @Test
    void tryCatchFinally() {
        Block t = top(body("try (var r = open(); r2) { a(); } catch (IOException | RuntimeException e) { b(); }"
                + " catch (Exception e) {} finally { c(); }")).get(0);
        assertEquals("{resources=var r = open(); r2}", t.fields().toString());
        assertEquals(1, t.slots().get("body").size());
        List<Block> cs = t.slots().get("catches");
        assertEquals("{type=IOException | RuntimeException, var=e}", cs.get(0).fields().toString());
        assertEquals("T.m~0/body/0/catches/0/body/0", cs.get(0).slots().get("body").get(0).id());
        assertEquals("T.m~0/body/0/finally/0", t.slots().get("finally").get(0).id());
        assertEquals(List.of("body", "catches", "finally"), List.copyOf(t.slots().keySet()));
    }

    @Test
    void throwBreakContinueLabels() {
        List<Block> b = top(body("outer: for (;;) { break outer; } throw new RuntimeException(\"x\");"));
        assertEquals("raw", b.get(0).kind());
        assertEquals("{value=new RuntimeException(\"x\")}", b.get(1).fields().toString());
        Block l = top(body("for (;;) { break; }")).get(0).slots().get("body").get(0);
        assertEquals("{}", l.fields().toString());
    }

    @Test
    void unsupportedBecomesRaw() {
        List<Block> b = top(body("synchronized (this) { x++; }\nclass L { }\nassert x > 0;\n{ x++; }\nint p = 1, q = 2;\n;"));
        for (Block r : b) assertEquals("raw", r.kind());
        assertEquals("synchronized (this) { x++; }", b.get(0).fields().get("text"));
        assertEquals("int p = 1, q = 2;", b.get(4).fields().get("text"));
        assertEquals("T.m~0/body/1", b.get(1).id());
    }

    @Test
    void rawKeepsInnerComments() {
        Block r = top(body("synchronized (this) {\n // inside\n x++;\n}")).get(0);
        assertEquals("raw", r.kind());
        assertTrue(r.fields().get("text").contains("// inside"));
    }

    @Test
    void constructorSuperCallIsRaw() {
        Block c = parse("class T { T() { super(); x(); } }");
        assertEquals("raw", top(c).get(0).kind());
        assertEquals("expr", top(c).get(1).kind());
    }

    @Test
    void comments() {
        List<Block> b = top(body("// before\nint a = 1; // trailing\n/* multi\n line */\nfoo();\n// last"));
        assertEquals(List.of("comment", "var", "comment", "comment", "expr", "comment"),
                b.stream().map(Block::kind).toList());
        assertEquals("before", b.get(0).fields().get("text"));
        assertEquals("trailing", b.get(2).fields().get("text"));
        assertEquals("last", b.get(5).fields().get("text"));
        assertEquals(2, b.get(0).span().startLine());
        assertEquals(3, b.get(2).span().startLine());
    }

    @Test
    void commentInsideNestedBlock() {
        Block i = top(body("if (x > 0) {\n // in then\n a();\n}")).get(0);
        assertEquals("comment", i.slots().get("then").get(0).kind());
        assertEquals("expr", i.slots().get("then").get(1).kind());
    }

    @Test
    void emptyBodyComment() {
        List<Block> b = top(body("// only"));
        assertEquals(1, b.size());
        assertEquals("comment", b.get(0).kind());
    }

    @Test
    void commentsBeforeCaseAndDefault() {
        List<Block> cases = top(body("switch (x) {\n // c1\n case 1:\n  a();\n  // end of 1\n // c2\n case 2 :\n // in 2\n  b();\n"
                + " /* cd */\n default:\n}")).get(0).slots().get("cases");
        assertEquals(List.of("comment", "case", "comment", "comment", "case", "comment", "case"),
                cases.stream().map(Block::kind).toList());
        assertEquals("c1", cases.get(0).fields().get("text"));
        assertEquals("end of 1", cases.get(2).fields().get("text"));
        assertEquals("cd", cases.get(5).fields().get("text"));
        assertEquals("comment", cases.get(4).slots().get("body").get(0).kind());
    }

    @Test
    void commentsBeforeCatchAndFinally() {
        Block t = top(body("try {\n a();\n} // after try\n// before catch\ncatch (RuntimeException e) {\n // in catch\n}"
                + "\n// before finally\nfinally {\n // in finally\n b();\n}")).get(0);
        List<Block> cs = t.slots().get("catches");
        assertEquals(List.of("comment", "comment", "catch", "comment"), cs.stream().map(Block::kind).toList());
        assertEquals("after try", cs.get(0).fields().get("text"));
        assertEquals("before finally", cs.get(3).fields().get("text"));
        assertEquals("in catch", cs.get(2).slots().get("body").get(0).fields().get("text"));
        assertEquals("in finally", t.slots().get("finally").get(0).fields().get("text"));
        Block onlyFinally = top(body("try { } /* f */ finally { }")).get(0);
        assertEquals("f", onlyFinally.slots().get("catches").get(0).fields().get("text"));
    }

    @Test
    void headerCommentsGoBeforeStatement() {
        List<Block> b = top(body("if (x > 0) /* h1 */ {\n a();\n} /* h2 */ else {\n}\nint /* h3 */ y = 1;"
                + "\ncatch1: ;\nfor (;;) // h4\n  break;"));
        List<String> kinds = b.stream().map(Block::kind).toList();
        assertEquals(List.of("comment", "comment", "if", "comment", "var", "raw", "comment", "for"), kinds);
    }

    @Test
    void arrowCaseComments() {
        List<Block> cases = top(body("switch (x) {\n // first\n case 1 -> a(); // tail\n case 2 -> {\n // inner\n b();\n }\n}"))
                .get(0).slots().get("cases");
        assertEquals(List.of("comment", "case", "comment", "case"), cases.stream().map(Block::kind).toList());
        assertEquals("comment", cases.get(3).slots().get("body").get(0).kind());
    }

    /** Весь корпус samples: комментарии не теряются, arrow-switch не уходит в raw. */
    @Test
    void corpus() throws Exception {
        List<Path> files;
        try (Stream<Path> s = Files.walk(Path.of("../../samples"))) {
            files = s.filter(p -> p.toString().endsWith(".java")).toList();
        }
        assertFalse(files.isEmpty());
        int switches = 0;
        List<String> unparsed = new ArrayList<>();
        for (Path p : files) {
            CompilationUnit cu;
            try {
                cu = StaticJavaParser.parse(p);
            } catch (ParseProblemException e) {
                unparsed.add(p.getFileName().toString());
                continue;
            }
            for (CallableDeclaration<?> d : cu.findAll(CallableDeclaration.class)) {
                Block b = AstToBlocks.convert(d, d.getNameAsString() + "~0", p.toString());
                assertNoCommentLost(d, b);
                for (Block x : all(b)) {
                    if (x.kind().equals("raw")) {
                        assertFalse(x.fields().get("text").startsWith("switch"), () -> p + ": " + x.fields());
                    }
                    if (x.kind().equals("switch")) switches++;
                }
            }
        }
        assertTrue(switches > 0);
        // JavaParser 3.26.2 не разбирает локальные enum/interface (Java 16) — известный пробел парсера
        assertEquals(List.of("NestedClasses.java"), unparsed);
    }
}
