package blueprints.source;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.source.TreeBuilder.ClassNode;
import blueprints.source.TreeBuilder.Method;
import blueprints.source.TreeBuilder.Param;
import blueprints.source.TreeBuilder.Pos;
import blueprints.source.TreeBuilder.Span;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Поля дерева для форм FE-10: fqn, заголовки (headerStart/headerEnd по правилу контракта), модификаторы, параметры. */
class TreeBuilderTest {
    static List<ClassNode> classes(String path, String text) {
        var p = ProjectLoader.load(List.of(new ProjectLoader.Upload(path, text.getBytes(StandardCharsets.UTF_8))));
        return TreeBuilder.build(p).get(0).files().get(0).classes();
    }

    /** Смещение позиции Monaco (line/column с 1, column в UTF-16) в строке Java; CR не входит в колонки. */
    static int offset(String text, Pos p) {
        int off = 0;
        for (int line = 1; line < p.line(); line++) off = text.indexOf('\n', off) + 1;
        return off + p.column() - 1;
    }

    /** Замена заголовка фронтом: [headerStart, headerEnd) → новый текст, «{»/«;» и дальше — как было. */
    static String replaceHeader(String text, Pos start, Pos end, String header) {
        return text.substring(0, offset(text, start)) + header + text.substring(offset(text, end));
    }

    /** Строки span (путь зависит от отрезанной загрузчиком общей папки). */
    static List<Integer> lines(Span s) {
        return List.of(s.startLine(), s.endLine());
    }

    static void assertHeader(String text, Pos start, Pos end, String startsWith, char brace) {
        assertTrue(text.startsWith(startsWith, offset(text, start)), "start " + start + ": " + text.substring(offset(text, start)));
        assertEquals(brace, text.charAt(offset(text, end)), "end " + end);
    }

    @Test
    void oneLinerKeepsBody() {
        String text = "class A { int f() { return 1; } }";
        ClassNode a = classes("A.java", text).get(0);
        assertEquals("A", a.fqn());
        assertEquals(new Pos(1, 1), a.headerStart());
        assertEquals(new Pos(1, 9), a.headerEnd());
        assertEquals(List.of(1, 1), lines(a.headerSpan()));
        Method f = a.methods().get(0);
        assertEquals(new Pos(1, 11), f.headerStart());
        assertEquals(new Pos(1, 19), f.headerEnd());
        assertEquals(List.of(1, 1), lines(f.span()));
        assertEquals("class A { long f() { return 1; } }", replaceHeader(text, f.headerStart(), f.headerEnd(), "long f() "));
        assertEquals("final class A { int f() { return 1; } }", replaceHeader(text, a.headerStart(), a.headerEnd(), "final class A "));
        assertEquals("int", f.returnType());
        assertEquals(List.of(), f.params());
        assertEquals(List.of(), f.thrown());
        assertEquals(List.of(), f.annotations());
        assertEquals(List.of(), a.implementsTypes());
        assertNull(a.extendsText());
        assertNull(a.typeParams());
    }

    @Test
    void annotationsOnOwnLinesAndBraceOnNextLine() {
        String text = """
                package a;

                /** doc */
                @Deprecated
                @SuppressWarnings({"x", "y"})
                public final class B<T extends Comparable<T>>
                    extends Base<T> implements Runnable, java.io.Serializable
                {
                    /** field doc */
                    @Deprecated
                    private int x = 1, y;

                    @Override
                    public void run()
                    {
                    }
                }
                """;
        ClassNode b = classes("a/B.java", text).get(0);
        assertEquals("a.B", b.fqn());
        assertEquals(new Pos(4, 1), b.headerStart());
        assertEquals(new Pos(8, 1), b.headerEnd());
        assertEquals(List.of(4, 8), lines(b.headerSpan()));
        assertEquals(List.of(4, 17), lines(b.span()));
        assertEquals(List.of("@Deprecated", "@SuppressWarnings({\"x\", \"y\"})"), b.annotations());
        assertEquals(List.of("public", "final"), b.modifiers());
        assertEquals("<T extends Comparable<T>>", b.typeParams());
        assertEquals("Base<T>", b.extendsText());
        assertEquals(List.of("Runnable", "java.io.Serializable"), b.implementsTypes());
        assertEquals(List.of(10, 11), lines(b.fields().get(0).span()));
        assertEquals(b.fields().get(0).span(), b.fields().get(1).span()); // int x, y — общий span
        Method run = b.methods().get(0);
        assertEquals(new Pos(13, 5), run.headerStart());
        assertEquals(new Pos(15, 5), run.headerEnd());
        assertEquals(List.of(13, 15), lines(run.headerSpan()));
        assertEquals(List.of(13, 16), lines(run.span()));
        assertEquals(List.of("@Override"), run.annotations());
        assertEquals(List.of("public"), run.modifiers());
        assertEquals("void", run.returnType());
        assertHeader(text, b.headerStart(), b.headerEnd(), "@Deprecated", '{');
    }

    @Test
    void crlfLines() {
        String text = "class C {\r\n  int x;\r\n  void m() {\r\n  }\r\n}\r\n";
        ClassNode c = classes("C.java", text).get(0);
        assertEquals(new Pos(1, 9), c.headerEnd());
        assertEquals(List.of(2, 2), lines(c.fields().get(0).span()));
        Method m = c.methods().get(0);
        assertEquals(new Pos(3, 3), m.headerStart());
        assertEquals(new Pos(3, 12), m.headerEnd());
        assertEquals(List.of(3, 4), lines(m.span()));
        assertEquals("class C {\r\n  int x;\r\n  int m() {\r\n  }\r\n}\r\n", replaceHeader(text, m.headerStart(), m.headerEnd(), "int m() "));
    }

    @Test
    void unicodeBeforeHeaderCountsUtf16() {
        String text = "/* 😀 é */ class D { /* 😀 */ void m() {} }";
        ClassNode d = classes("D.java", text).get(0);
        assertEquals(new Pos(1, 12), d.headerStart()); // 😀 — две UTF-16 единицы
        Method m = d.methods().get(0);
        assertEquals(new Pos(1, 31), m.headerStart());
        assertEquals(new Pos(1, 40), m.headerEnd());
        assertHeader(text, d.headerStart(), d.headerEnd(), "class D", '{');
        assertHeader(text, m.headerStart(), m.headerEnd(), "void m()", '{');
    }

    @Test
    void interfaceAndAbstractMethodsEndAtSemicolon() {
        String text = """
                package p;
                public interface I extends Runnable, Comparable<I> {
                    int f(int a, final String... rest) throws java.io.IOException, RuntimeException;
                    default <X> X g(X x) { return x; }
                }
                abstract class K implements I {
                    protected abstract void h();
                }
                """;
        List<ClassNode> cs = classes("p/I.java", text);
        ClassNode i = cs.get(0);
        assertEquals("interface", i.kind());
        assertEquals("Runnable, Comparable<I>", i.extendsText());
        assertEquals(List.of(), i.implementsTypes());
        Method f = i.methods().get(0);
        assertHeader(text, f.headerStart(), f.headerEnd(), "int f(", ';');
        assertEquals(List.of(3, 3), lines(f.headerSpan()));
        assertEquals(List.of(new Param("a", "int"), new Param("rest", "String...")), f.params());
        assertEquals(List.of("java.io.IOException", "RuntimeException"), f.thrown());
        assertEquals(List.of(), f.modifiers());
        Method g = i.methods().get(1);
        assertEquals(List.of("default"), g.modifiers());
        assertEquals("<X>", g.typeParams());
        assertEquals("X", g.returnType());
        assertHeader(text, g.headerStart(), g.headerEnd(), "default <X>", '{');
        ClassNode k = cs.get(1);
        assertEquals(List.of("abstract"), k.modifiers());
        assertEquals(List.of("I"), k.implementsTypes());
        Method h = k.methods().get(0);
        assertEquals(List.of("protected", "abstract"), h.modifiers());
        assertHeader(text, h.headerStart(), h.headerEnd(), "protected abstract void h()", ';');
    }

    @Test
    void recordAndEnum() {
        String text = """
                package r;
                public record R(int a, @Deprecated String b) implements Comparable<R> {
                    public R { }
                    public int compareTo(R o) { return 0; }
                    enum E implements Runnable {
                        A(1), B(2);
                        private final int v;
                        E(int v) { this.v = v; }
                        public void run() {}
                    }
                }
                """;
        List<ClassNode> cs = classes("r/R.java", text);
        ClassNode r = cs.get(0);
        assertEquals("record", r.kind());
        assertEquals("r.R", r.fqn());
        assertEquals(List.of("Comparable<R>"), r.implementsTypes());
        assertHeader(text, r.headerStart(), r.headerEnd(), "public record R(int a", '{');
        assertEquals(new Pos(2, 71), r.headerEnd());
        assertEquals(List.of("a", "b"), r.fields().stream().map(TreeBuilder.Field::name).toList());
        assertNull(r.fields().get(0).span()); // компоненты record — в заголовке
        ClassNode e = cs.get(1);
        assertEquals("R$E", e.name());
        assertEquals("r.R.E", e.fqn());
        assertEquals("enum", e.kind());
        assertEquals(List.of("Runnable"), e.implementsTypes());
        assertHeader(text, e.headerStart(), e.headerEnd(), "enum E", '{');
        assertEquals(List.of(7, 7), lines(e.fields().get(0).span()));
        Method ctor = e.constructors().get(0);
        assertEquals("r.R$E.<init>~0", ctor.id());
        assertNull(ctor.returnType());
        assertEquals(List.of(new Param("v", "int")), ctor.params());
        assertHeader(text, ctor.headerStart(), ctor.headerEnd(), "E(int v)", '{');
    }
}
