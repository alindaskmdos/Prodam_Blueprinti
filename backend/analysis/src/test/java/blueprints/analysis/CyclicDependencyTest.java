package blueprints.analysis;

import static blueprints.analysis.UmlModelTest.files;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
import blueprints.model.Span;
import java.util.List;
import org.junit.jupiter.api.Test;

class CyclicDependencyTest {
    @Test
    void twoClassCycleIsLow() {
        ProjectAnalysis p = ProjectAnalysis.of(files(
                "s/Cart.java", "package s;\npublic class Cart {\n  Pricing pricing;\n  Item item;\n}\n",
                "s/Pricing.java", "package s;\npublic class Pricing {\n  double total(Cart c) { return 0; }\n}\n",
                "s/Item.java", "package s;\npublic record Item(String name) {}\n"));
        DependencyGraph g = p.dependencies();
        assertEquals(1, g.cycles().size());
        DependencyGraph.Cycle c = g.cycles().get(0);
        assertEquals(List.of("s.Cart", "s.Pricing"), c.classes());
        assertEquals("low", c.severity());
        assertTrue(g.edges().contains(new DependencyGraph.Edge("s.Cart", "s.Pricing", true)));
        assertTrue(g.edges().contains(new DependencyGraph.Edge("s.Pricing", "s.Cart", true)));
        assertTrue(g.edges().contains(new DependencyGraph.Edge("s.Cart", "s.Item", false)));

        List<Issue> issues = new CyclicDependency().detectProject(p);
        assertEquals(1, issues.size());
        Issue i = issues.get(0);
        assertEquals(c.issueId(), i.id());
        assertEquals("CyclicDependency", i.rule());
        assertEquals("low", i.severity());
        assertEquals("high", i.confidence());
        assertNull(i.methodId());
        assertNull(i.blockId());
        assertEquals(List.of("s.Cart", "s.Pricing"), i.classIds());
        assertEquals(new Span("s/Cart.java", 2, 5), i.span());
        assertEquals("Циклическая зависимость классов: Cart → Pricing → Cart", i.message());
        assertTrue(i.fixes().isEmpty());
        assertTrue(i.recommendation() != null && !i.recommendation().isBlank());
        // попадает в общий прогон реестра
        assertTrue(DetectorRegistry.defaults().run(p).stream().anyMatch(x -> x.id().equals(c.issueId())));
    }

    @Test
    void threeClassCycleIsMedium() {
        ProjectAnalysis p = ProjectAnalysis.of(files(
                "a/A.java", "package a; public class A { B b; }",
                "a/B.java", "package a; public class B { void f() { C.g(); } }",
                "a/C.java", "package a; public class C { static void g() {} java.util.List<A> all; }",
                "a/D.java", "package a; public class D { A a; }"));
        DependencyGraph g = p.dependencies();
        assertEquals(1, g.cycles().size());
        assertEquals(List.of("a.A", "a.B", "a.C"), g.cycles().get(0).classes());
        assertEquals("medium", g.cycles().get(0).severity());
        assertTrue(g.edges().contains(new DependencyGraph.Edge("a.D", "a.A", false)));
        Issue i = new CyclicDependency().detectProject(p).get(0);
        assertEquals("medium", i.severity());
        assertEquals("Циклическая зависимость классов: A → B → C → A", i.message());
    }

    @Test
    void outerAndNestedAreNotACycle() {
        ProjectAnalysis p = ProjectAnalysis.of(files(
                "n/Outer.java", "package n; public class Outer { Inner in; static class Inner { Outer back; } }"));
        DependencyGraph g = p.dependencies();
        assertTrue(g.edges().isEmpty(), g.edges().toString());
        assertTrue(g.cycles().isEmpty());
        assertTrue(new CyclicDependency().detectProject(p).isEmpty());
        assertEquals(List.of("n.Outer", "n.Outer.Inner"), g.nodes().stream().map(DependencyGraph.Node::id).toList());
    }

    @Test
    void demoHasNoCycles() throws Exception {
        ProjectAnalysis p = ProjectAnalysis.of(ProjectAnalysisTest.demoFiles());
        assertTrue(p.dependencies().cycles().isEmpty());
        assertFalse(p.dependencies().edges().isEmpty());
        assertTrue(p.dependencies().edges().stream().noneMatch(DependencyGraph.Edge::inCycle));
        assertTrue(new CyclicDependency().detectProject(p).isEmpty());
    }
}
