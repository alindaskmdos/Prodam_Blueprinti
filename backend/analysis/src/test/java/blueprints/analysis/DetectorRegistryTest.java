package blueprints.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
import blueprints.source.SourceFile;
import java.util.List;
import org.junit.jupiter.api.Test;

class DetectorRegistryTest {
    record Stub(String id) implements Detector {
        @Override
        public List<Issue> detect(MethodAnalysis method, ProjectAnalysis project) {
            return List.of();
        }
    }

    @Test
    void keepsRegistrationOrder() {
        Detector a = new Stub("a");
        Detector b = new Stub("b");
        assertEquals(List.of(a, b), new DetectorRegistry(List.of(a, b)).detectors());
    }

    @Test
    void defaultsRegisterDetectors() {
        assertTrue(DetectorRegistry.defaults().detectors().stream().anyMatch(d -> d instanceof NestedLoopSameCollection));
        assertTrue(DetectorRegistry.defaults().detectors().stream().anyMatch(d -> d instanceof LinearSearchInLoop));
        assertTrue(DetectorRegistry.defaults().detectors().stream().anyMatch(d -> d instanceof ExpensiveCallInLoop));
        assertTrue(DetectorRegistry.defaults().detectors().stream().anyMatch(d -> d instanceof StringConcatInLoop));
        assertTrue(DetectorRegistry.defaults().detectors().stream().anyMatch(d -> d instanceof CyclicDependency));
    }

    @Test
    void opsFollowProjectN() {
        String src = """
                class A {
                    java.util.List<Integer> orders;
                    int f() {
                        int s = 0;
                        for (Integer a : orders) for (Integer b : orders) s++;
                        return s;
                    }
                }""";
        List<SourceFile> files = List.of(new SourceFile("A.java", "", src.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        Issue.Complexity byDefault = DetectorRegistry.defaults().run(ProjectAnalysis.of(files))
                .get(0).complexity();
        assertEquals(1e8, byDefault.opsBefore().doubleValue());
        assertEquals(1e4, byDefault.opsAfter().doubleValue());
        Issue.Complexity at500 = DetectorRegistry.defaults().run(ProjectAnalysis.of(files, 500))
                .get(0).complexity();
        assertEquals(250_000.0, at500.opsBefore().doubleValue());
        assertEquals(500.0, at500.opsAfter().doubleValue());
    }
}
