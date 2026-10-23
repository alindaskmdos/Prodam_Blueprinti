package blueprints.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class DetectorRegistryTest {
    @Test
    void keepsRegistrationOrder() {
        Detector a = () -> "a";
        Detector b = () -> "b";
        assertEquals(List.of(a, b), new DetectorRegistry(List.of(a, b)).detectors());
    }

    @Test
    void defaultsStartEmpty() {
        assertTrue(DetectorRegistry.defaults().detectors().isEmpty());
    }
}
