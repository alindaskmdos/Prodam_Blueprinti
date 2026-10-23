package blueprints.analysis;

import blueprints.model.Issue;
import java.util.List;

/**
 * §8.3: глубокая вложенность — {@link MethodAnalysis#maxNesting()} больше {@link #MAX_NESTING}. Одна проблема на метод,
 * span — самая глубокая конструкция ({@link MethodAnalysis#deepestConstruct()}), severity low, confidence high.
 */
public final class DeepNesting implements Detector {
    /** Порог: тело метода (1) + три уровня (цикл / цикл / условие) ещё читаются, следующий — сигнал выделить метод. */
    public static final int MAX_NESTING = 4;

    @Override
    public String id() {
        return "DeepNesting";
    }

    @Override
    public List<Issue> detect(MethodAnalysis m, ProjectAnalysis project) {
        int depth = m.maxNesting();
        if (depth <= MAX_NESTING) return List.of();
        return List.of(Issues.of(id(), "low", "high", m, m.deepestConstruct(),
                "Глубокая вложенность в «" + m.name() + "»: " + depth + " уровней (порог " + MAX_NESTING + ")",
                "Выделить метод: вынести внутренние уровни в отдельный метод или заменить условия ранним выходом (continue/return)",
                null, null));
    }
}
