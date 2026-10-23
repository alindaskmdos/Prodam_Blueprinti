package blueprints.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
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
    }
}
