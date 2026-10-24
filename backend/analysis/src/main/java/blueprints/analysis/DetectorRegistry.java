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

    /** Встроенные детекторы (без PMD — его ruleset задаёт проект, см. {@link #defaults(String)}). */
    public static DetectorRegistry defaults() {
        return new DetectorRegistry(builtIn());
    }

    /**
     * Встроенные детекторы + {@link PmdDetector} с ruleset проекта ({@code .blueprints/pmd-ruleset.xml}, прошедший
     * {@link PmdDetector#validate}) или {@link PmdDetector#DEFAULT_RULESET}.
     */
    public static DetectorRegistry defaults(String pmdRuleset) {
        List<Detector> all = new ArrayList<>(builtIn());
        all.add(new PmdDetector(pmdRuleset));
        return new DetectorRegistry(all);
    }

    private static List<Detector> builtIn() {
        return List.of(new NestedLoopSameCollection(), new LinearSearchInLoop(), new ExpensiveCallInLoop(),
                new StringConcatInLoop(), new LongMethod(), new DeepNesting(), new DeadCode(), new CyclicDependency());
    }

    public List<Detector> detectors() {
        return detectors;
    }

    /** Все проблемы проекта: методы по порядку файлов, внутри метода — детекторы по порядку регистрации; затем находки уровня проекта. */
    public List<Issue> run(ProjectAnalysis project) {
        List<Issue> out = new ArrayList<>();
        for (MethodAnalysis m : project.methods()) for (Detector d : detectors) out.addAll(d.detect(m, project));
        for (Detector d : detectors) out.addAll(d.detectProject(project));
        return out;
    }
}
