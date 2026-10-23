package blueprints.analysis;

import static blueprints.analysis.ProjectAnalysisTest.analyze;
import static blueprints.analysis.ProjectAnalysisTest.m;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
import blueprints.model.Span;
import java.io.IOException;
import java.util.List;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class StringConcatInLoopTest {
    private static final Detector D = new StringConcatInLoop();

    private static List<Issue> run(ProjectAnalysis p, String id) {
        return D.detect(m(p, id), p);
    }

    @Test
    void concatInLoop() {
        ProjectAnalysis p = analyze("""
                class A {
                    String join(List<String> xs) {
                        String s = "";
                        for (String x : xs) {
                            s += x;
                            s = s + "," + x;
                        }
                        return s;
                    }
                    String nested(List<String> xs, List<String> ys) {
                        String s = "";
                        for (int i = 0; i < 3; i++)
                            for (String x : xs)
                                for (String y : ys) s += x + y;
                        return s;
                    }
                    String inner(List<String> xs, List<String> ys) {
                        List<String> out = new ArrayList<>();
                        for (String x : xs) {
                            String line = x;
                            for (String y : ys) line += y;
                            out.add(line);
                        }
                        return out.toString();
                    }
                    String w(int k) { var s = ""; int i = 0; while (i < k) { s += i; i++; } return s; }
                }
                """);
        List<Issue> j = run(p, "p.A.join~0");
        assertEquals(1, j.size(), "одна находка на переменную и цикл");
        Issue i = j.get(0);
        assertEquals("StringConcatInLoop", i.rule());
        assertEquals("high", i.confidence());
        assertEquals(new Span("src/p/F0.java", 6, 9), i.span(), "span — цикл целиком");
        assertEquals("O(n²)", i.complexity().before());
        assertEquals("O(n)", i.complexity().after());
        assertTrue(i.message().contains("«s»"), i.message());
        assertTrue(i.recommendation().contains("StringBuilder"));

        List<Issue> n = run(p, "p.A.nested~0");
        assertEquals(1, n.size());
        assertEquals(14, n.get(0).span().startLine(), "внешний цикл, в котором живёт строка");

        List<Issue> in = run(p, "p.A.inner~0");
        assertEquals(1, in.size());
        assertEquals(23, in.get(0).span().startLine(), "строка живёт только внутри внешней итерации");
        assertEquals("O(n²)", in.get(0).complexity().before());

        assertEquals("high", run(p, "p.A.w~0").get(0).confidence(), "var из строкового литерала; while не понижает");
    }

    @Test
    void oneIssuePerLoopForInitAndScopes() {
        ProjectAnalysis p = analyze("""
                class A {
                    String load() { return ""; }
                    String two(List<String> xs) { String a = ""; String b = ""; for (String x : xs) { a += x; b += x; a += "!"; } return a + b; }
                    String init(List<String> xs) { for (String s = ""; s.length() < xs.size(); ) s += "x"; return ""; }
                    void scopes(List<String> xs) {
                        { var s = load(); for (String x : xs) s += x; }
                        { String s = ""; for (String x : xs) s += x; }
                    }
                }
                """);
        List<Issue> two = run(p, "p.A.two~0");
        assertEquals(1, two.size(), "одна находка на цикл — иначе одинаковые id");
        assertTrue(two.get(0).message().contains("«a», «b»"), two.get(0).message());
        List<StringConcatInLoop.Concat> cs = StringConcatInLoop.concats(m(p, "p.A.two~0"));
        assertEquals(List.of("a", "b", "a"), cs.stream().map(StringConcatInLoop.Concat::variable).toList());
        assertTrue(cs.stream().allMatch(c -> c.loop() == cs.get(0).loop() && c.declaration() != null));

        assertEquals(1, run(p, "p.A.init~0").size(), "строка из init for переживает итерации");

        List<Issue> sc = run(p, "p.A.scopes~0");
        assertEquals(List.of("low", "high"), sc.stream().map(Issue::confidence).toList(), "метка low по объявлению, не по имени");
        assertEquals(2, sc.stream().map(Issue::id).distinct().count());
    }

    @Test
    void negatives() {
        ProjectAnalysis p = analyze("""
                class A {
                    String sb(List<String> xs) { StringBuilder b = new StringBuilder(); for (String x : xs) b.append(x); return b.toString(); }
                    String outside(String a) { String s = ""; s += a; s = s + a; return s; }
                    void perIteration(List<String> xs, List<String> out) { for (String x : xs) { String l = ""; l += x; l = l + "!"; out.add(l); } }
                    int ints(List<Integer> xs) { int s = 0; long t = 0; for (int x : xs) { s += x; t = t + x; } return s; }
                    String consts() { String s = ""; for (int i = 0; i < 3; i++) s += i; return s; }
                    String prepend(List<String> xs) { String s = ""; for (String x : xs) s = x + s; return s; }
                    void loopVar(List<String> xs, List<String> out) { for (String x : xs) { x += "!"; out.add(x); } }
                }
                """);
        for (String id : List.of("p.A.sb~0", "p.A.outside~0", "p.A.perIteration~0", "p.A.ints~0", "p.A.consts~0",
                "p.A.prepend~0", "p.A.loopVar~0")) {
            assertTrue(run(p, id).isEmpty(), id);
        }
    }

    @Test
    void unknownTypeIsLow() {
        ProjectAnalysis p = analyze("""
                class A extends B {
                    void f(List<String> xs) { for (String x : xs) text += x; }
                    String g(List<String> xs) { String s = ""; for (String x : xs) { s += x; } return s; }
                }
                """);
        List<Issue> f = run(p, "p.A.f~0");
        assertEquals(1, f.size());
        assertEquals("low", f.get(0).confidence(), "унаследованное поле неизвестного типа");
        assertEquals("high", run(p, "p.A.g~0").get(0).confidence());
    }

    @Test
    void demo() throws IOException {
        ProjectAnalysis demo = ProjectAnalysis.of(ProjectAnalysisTest.demoFiles());
        List<String> found = DetectorRegistry.defaults().run(demo).stream()
                .filter(i -> i.rule().equals("StringConcatInLoop"))
                .map(i -> i.methodId() + ":" + i.span().startLine() + ":" + i.confidence())
                .collect(Collectors.toList());
        assertEquals(List.of("com.demo.service.ReportService.fullReport~0:38:high", "com.demo.util.Texts.join~0:40:high"), found);
    }
}
