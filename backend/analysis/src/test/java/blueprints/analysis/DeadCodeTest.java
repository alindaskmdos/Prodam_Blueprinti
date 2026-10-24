package blueprints.analysis;

import static blueprints.analysis.ProjectAnalysisTest.analyze;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;

class DeadCodeTest {
    private static List<Issue> issues(ProjectAnalysis p) {
        return DetectorRegistry.defaults().run(p).stream().filter(i -> i.rule().equals("DeadCode")).toList();
    }

    private static List<String> hits(ProjectAnalysis p) {
        return issues(p).stream().map(i -> i.methodId() + " " + i.span().startLine() + " " + i.severity() + "/" + i.confidence()
                + " " + i.message()).toList();
    }

    @Test
    void privateMethodsLocalsUnreachable() {
        ProjectAnalysis p = analyze("""
                class A {
                    private int dead() { return dead(); }
                    private int used() { return 1; }
                    private int byRef() { return 2; }
                    private int viaLambda() { return 3; }
                    private int byReflection() { return 4; }
                    private int overload(int a) { return a; }
                    private int overload(String s) { return 0; }
                    public int api() {
                        int unused = used();
                        int x = 1;
                        java.util.function.IntSupplier s = this::byRef;
                        Runnable r = () -> viaLambda();
                        for (int i = 0; i < 2; i++) { r.run(); }
                        try (var in = new java.io.StringReader("byReflection")) { } catch (Exception e) { }
                        return x + overload(1) + s.getAsInt();
                    }
                    int flow(int a) {
                        if (a > 0) { return 1; a++; }
                        switch (a) { case 0: break; case 1: return 2; }
                        throw new IllegalStateException();
                    }
                    class Inner { void g() { used(); } }
                }
                """);
        assertEquals(List.of(
                "p.A.dead~0 4 low/high Приватный метод «dead» нигде не вызывается",
                "p.A.byReflection~0 8 low/low Приватный метод «byReflection» нигде не вызывается (имя есть в строке — возможно, рефлексия)",
                "p.A.api~0 12 low/high Локальная переменная «unused» не используется",
                "p.A.flow~0 21 medium/high Недостижимый код после return"), hits(p),
                "рекурсия не спасает dead; ссылка на метод, лямбда, вызов из вложенного класса, перегрузка той же арности по имени,"
                        + " переменные for/try/catch, break в конце case, неиспользуемые неприватные api/flow/Inner.g — не сообщаются");
        Issue i = issues(p).get(0);
        assertEquals("DeadCode:p.A.dead~0:4:17", i.id());
        assertTrue(i.fixes().isEmpty());
        assertEquals(null, i.complexity());
    }

    @Test
    void exclusionsNotReported() {
        ProjectAnalysis p = analyze("""
                class Impl {
                    public void neverCalled() {}
                    void packagePrivate() {}
                    protected void forSubclasses() {}
                    private static void main(String[] args) {}
                    private String toString(int x) { return ""; }
                    @org.junit.jupiter.api.Test private void annotated() {}
                    private Impl() {}
                    private void writeObject(java.io.ObjectOutputStream out) {}
                    private void readObject(java.io.ObjectInputStream in) {}
                    private void readObjectNoData() {}
                    private Object readResolve() { return this; }
                    private Object writeReplace() { return this; }
                    private void onlyByRef(String s) {}
                    public void refs(List<String> l) {
                        List<String> list = l;
                        java.util.function.Consumer<String> c = list::add;
                        java.util.function.Consumer<String> d = Impl::onlyByRef;
                        c.accept("x");
                        d.accept("y");
                    }
                }
                """);
        assertEquals(List.of(), hits(p), "неприватные, main, toString, аннотации, конструкторы, сериализация,"
                + " локальная и приватный метод только в ссылке на метод — не сообщаются");
    }

    @Test
    void demoHasNoDeadCode() throws IOException {
        assertEquals(List.of(), hits(ProjectAnalysis.of(ProjectAnalysisTest.demoFiles())));
    }
}
