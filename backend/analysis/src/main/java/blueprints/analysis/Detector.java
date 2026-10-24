package blueprints.analysis;

import blueprints.model.Issue;
import java.util.List;

/**
 * Точка расширения: правило анализа. Новое правило = новый класс + регистрация в {@link DetectorRegistry#defaults()}.
 * Получает разобранный метод (AST, символы размера, Big O, размеры циклов, стоимости и цели вызовов)
 * и весь проект (граф вызовов, другие методы). Неуверенный вывод — Issue с confidence "low" и пустыми fixes.
 * Правило уровня проекта (циклы зависимостей классов и т.п.) переопределяет {@link #detectProject}: его Issue без methodId/blockId,
 * с classIds; {@link #detect} у него возвращает пустой список.
 */
public interface Detector {
    String id();

    List<Issue> detect(MethodAnalysis method, ProjectAnalysis project);

    /** Находки уровня проекта; вызывается один раз на проект после всех методов. */
    default List<Issue> detectProject(ProjectAnalysis project) {
        return List.of();
    }
}
