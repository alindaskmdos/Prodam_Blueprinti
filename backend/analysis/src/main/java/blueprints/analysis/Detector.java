package blueprints.analysis;

import blueprints.model.Issue;
import java.util.List;

/**
 * Точка расширения: правило анализа. Новое правило = новый класс + регистрация в {@link DetectorRegistry#defaults()}.
 * Получает разобранный метод (AST, символы размера, Big O, размеры циклов, стоимости и цели вызовов)
 * и весь проект (граф вызовов, другие методы). Неуверенный вывод — Issue с confidence "low" и пустыми fixes.
 */
public interface Detector {
    String id();

    List<Issue> detect(MethodAnalysis method, ProjectAnalysis project);
}
