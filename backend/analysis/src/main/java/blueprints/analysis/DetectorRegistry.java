package blueprints.analysis;

import blueprints.model.Issue;
import java.util.ArrayList;
import java.util.List;

/** Список детекторов; новое правило = новый класс + строка в {@link #defaults()}. */
public final class DetectorRegistry {
    private final List<Detector> detectors;

    public DetectorRegistry(List<Detector> detectors) {
        this.detectors = List.copyOf(detectors);
    }

    public static DetectorRegistry defaults() {
        return new DetectorRegistry(List.of(new NestedLoopSameCollection(), new LinearSearchInLoop(), new ExpensiveCallInLoop(),
                new StringConcatInLoop(), new LongMethod(), new DeepNesting(), new DeadCode()));
    }

    public List<Detector> detectors() {
        return detectors;
    }

    /** Все проблемы проекта: методы по порядку файлов, внутри метода — детекторы по порядку регистрации. */
    public List<Issue> run(ProjectAnalysis project) {
        List<Issue> out = new ArrayList<>();
        for (MethodAnalysis m : project.methods()) for (Detector d : detectors) out.addAll(d.detect(m, project));
        return out;
    }
}
