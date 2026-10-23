package blueprints.testing;

import static org.junit.jupiter.api.Assertions.assertEquals;

import blueprints.runner.Runner;
import java.util.List;
import org.junit.jupiter.api.Test;

class TestSourceRegistryTest {
    @Test
    void defaultsContainIoAndJUnitSources() {
        var reg = TestSourceRegistry.defaults(new Runner(Runner.Config.defaults()));
        assertEquals(List.of("io", "junit"), reg.sources().stream().map(TestSource::id).toList());
    }
}
