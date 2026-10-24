package blueprints.analysis;

import blueprints.model.Issue;
import java.util.List;

/**
 * §8.3: длинный метод — {@link MethodAnalysis#lines()} больше {@link #MAX_LINES}. Span — объявление метода,
 * severity low (качество, не производительность), confidence high, рекомендация — выделить метод.
 */
public final class LongMethod implements Detector {
    /**
     * Порог 30 (решение человека, BE-54): при 50 правило молчало на тестовых проектах. На samples/demo
     * срабатывает и на плоском диспетчере Main.dispatch (50 строк).
     */
    public static final int MAX_LINES = 30;

    @Override
    public String id() {
        return "LongMethod";
    }

    @Override
    public List<Issue> detect(MethodAnalysis m, ProjectAnalysis project) {
        int lines = m.lines();
        if (lines <= MAX_LINES) return List.of();
        return List.of(Issues.of(id(), "low", "high", m, m.declaration(),
                "Длинный метод «" + m.name() + "»: " + lines + " строк (порог " + MAX_LINES + ")",
                "Выделить метод: вынести самостоятельные шаги в отдельные методы с говорящими именами", null, null));
    }
}
