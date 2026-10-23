package blueprints.testing;

import blueprints.runner.Runner;
import blueprints.testing.io.IoTestSource;
import java.util.List;

/** Список источников тестов; новый источник = новый класс + строка в {@link #defaults}. */
public final class TestSourceRegistry {
    private final List<TestSource> sources;

    public TestSourceRegistry(List<TestSource> sources) {
        this.sources = List.copyOf(sources);
    }

    public static TestSourceRegistry defaults(Runner runner) {
        return new TestSourceRegistry(List.of(
                new IoTestSource(runner)));
    }

    public List<TestSource> sources() {
        return sources;
    }
}
