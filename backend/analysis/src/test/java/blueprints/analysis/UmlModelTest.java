package blueprints.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.source.SourceFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class UmlModelTest {
    static List<SourceFile> files(String... pathAndText) {
        List<SourceFile> out = new ArrayList<>();
        for (int i = 0; i < pathAndText.length; i += 2) {
            String path = pathAndText[i];
            String pkg = path.contains("/") ? path.substring(0, path.lastIndexOf('/')).replace('/', '.') : "";
            out.add(new SourceFile(path, pkg, pathAndText[i + 1].getBytes(StandardCharsets.UTF_8)));
        }
        return out;
    }

    static UmlModel.Relation rel(UmlModel m, String from, String to) {
        return m.relations().stream().filter(r -> r.from().equals(from) && r.to().equals(to)).findFirst().orElse(null);
    }

    static UmlModel uml(String... pathAndText) {
        return ProjectAnalysis.of(files(pathAndText)).uml();
    }

    @Test
    void fieldRelationsByHeuristic() {
        UmlModel m = uml(
                "a/Part.java", "package a; public class Part {}",
                "a/Engine.java", "package a; public class Engine {}",
                "a/Wheel.java", "package a; public class Wheel {}",
                "a/Driver.java", "package a; public class Driver {}",
                "a/Car.java", """
                        package a;
                        import java.util.*;
                        public class Car {
                            private final Engine engine = new Engine();
                            private final Driver driver;
                            private Part spare;
                            private final List<Wheel> wheels = new ArrayList<>();
                            private Part[] parts;
                            private Map<String, Set<Driver>> byName;
                            private String label;
                            public Car(Driver driver) { this.driver = driver; }
                            void setSpare(Part p) { spare = p; }
                        }""");
        assertEquals(new UmlModel.Relation("a.Car", "a.Engine", "composition", true, "1", "engine"), rel(m, "a.Car", "a.Engine"));
        assertEquals(new UmlModel.Relation("a.Car", "a.Wheel", "aggregation", true, "*", "wheels"), rel(m, "a.Car", "a.Wheel"));
        // поле driver из параметра конструктора (aggregation «1») сильнее, чем Map по значению Set<Driver> (aggregation «*»): первое остаётся
        assertEquals(new UmlModel.Relation("a.Car", "a.Driver", "aggregation", true, "1", "driver"), rel(m, "a.Car", "a.Driver"));
        // spare — association, parts (массив) — aggregation «*» сильнее
        assertEquals(new UmlModel.Relation("a.Car", "a.Part", "aggregation", true, "*", "parts"), rel(m, "a.Car", "a.Part"));
        assertEquals(4, m.relations().size(), m.relations().toString()); // String — без стрелок
    }

    @Test
    void associationExtendsImplementsAndDependency() {
        UmlModel m = uml(
                "p/Shape.java", "package p; public interface Shape { double area(); }",
                "p/Base.java", "package p; public abstract class Base implements Shape {}",
                "p/Color.java", "package p; public enum Color { RED }",
                "p/Util.java", "package p; public final class Util { static int twice(int x) { return 2 * x; } }",
                "p/Circle.java", """
                        package p;
                        public class Circle extends Base {
                            private Color color = Color.RED;
                            public double area() { return Util.twice(1); }
                            Shape copy() { return this; }
                        }""");
        assertEquals("extends", rel(m, "p.Circle", "p.Base").kind());
        assertNull(rel(m, "p.Circle", "p.Base").via());
        assertEquals("implements", rel(m, "p.Base", "p.Shape").kind());
        assertEquals(new UmlModel.Relation("p.Circle", "p.Color", "association", false, "1", "color"), rel(m, "p.Circle", "p.Color"));
        assertEquals(new UmlModel.Relation("p.Circle", "p.Util", "dependency", false, null, "area"), rel(m, "p.Circle", "p.Util"));
        assertEquals(new UmlModel.Relation("p.Circle", "p.Shape", "dependency", false, null, "copy"), rel(m, "p.Circle", "p.Shape"));
        assertNull(rel(m, "p.Circle", "p.Circle"));
    }

    @Test
    void nestedIdsTypeParamsAndImports() {
        UmlModel m = uml(
                "x/Box.java", """
                        package x;
                        public class Box<T> {
                            private T value;
                            public static class Item { }
                            private Item item;
                            <Box> void m(Box b) {}
                        }""",
                "y/User.java", """
                        package y;
                        import x.Box;
                        public class User {
                            Box.Item it;
                            public User() { new x.Box<String>(); }
                        }""",
                "y/T.java", "package y; public class T {}");
        UmlModel.Clazz item = m.clazz("x.Box.Item");
        assertEquals("Box.Item", item.name());
        assertEquals("<T>", m.clazz("x.Box").typeParams());
        assertNull(item.typeParams());
        assertEquals("association", rel(m, "x.Box", "x.Box.Item").kind());
        assertEquals("association", rel(m, "y.User", "x.Box.Item").kind());
        assertEquals(new UmlModel.Relation("y.User", "x.Box", "dependency", false, null, "User"), rel(m, "y.User", "x.Box"));
        assertNull(rel(m, "x.Box", "y.T")); // T — параметр типа, не класс проекта
        assertTrue(m.nested("x.Box", "x.Box.Item"));
        assertFalse(m.nested("x.Box", "y.User"));
    }

    @Test
    void cardsMatchTreeIds() {
        UmlModel m = uml(
                "r/Point.java", """
                        package r;
                        public record Point(int x, int y) {
                            public Point { }
                            public Point(int v) { this(v, v); }
                            interface Op { int apply(int a); }
                            int sum() { return x + y; }
                            int sum(int k) { return k; }
                        }""");
        UmlModel.Clazz p = m.clazz("r.Point");
        assertEquals("record", p.kind());
        assertEquals(List.of("x", "y"), p.fields().stream().map(UmlModel.Field::name).toList());
        assertEquals(List.of("private", "final"), p.fields().get(0).modifiers());
        assertEquals(List.of("r.Point.<init>~0"), p.constructors().stream().map(UmlModel.Member::id).toList());
        assertEquals("public Point(int v)", p.constructors().get(0).signature());
        assertEquals(List.of("r.Point.sum~0", "r.Point.sum~1"), p.methods().stream().map(UmlModel.Member::id).toList());
        UmlModel.Member apply = m.clazz("r.Point.Op").methods().get(0);
        assertEquals("r.Point$Op.apply~0", apply.id());
        assertEquals("int apply(int a)", apply.signature());
        assertEquals("interface", m.clazz("r.Point.Op").kind());
    }

    @Test
    void demoHasNoRelationsToJdk() throws Exception {
        UmlModel m = ProjectAnalysis.of(ProjectAnalysisTest.demoFiles()).uml();
        assertEquals(20, m.classes().size());
        for (UmlModel.Relation r : m.relations()) {
            assertTrue(m.clazz(r.from()) != null && m.clazz(r.to()) != null, r.toString());
            assertEquals(r.kind().equals("aggregation") || r.kind().equals("composition"), r.heuristic(), r.toString());
        }
        assertEquals("composition", rel(m, "com.demo.Main", "com.demo.service.Catalog").kind());
        assertEquals("aggregation", rel(m, "com.demo.service.OrderService", "com.demo.service.Catalog").kind());
        assertEquals("*", rel(m, "com.demo.model.Order", "com.demo.model.OrderLine").multiplicity());
    }
}
