package blueprints.fixes;

import java.util.Map;

/**
 * Точка расширения: рефакторинг/quick-fix. Обязан обновлять ссылки во всех файлах проекта, включая tests/*.java.
 * Файлы проекта пока Map путь-&gt;исходник; заменить на ProjectSnapshot из model (BE-05).
 */
public interface Refactoring {
    String id();

    boolean canApply(Map<String, String> files, String target);

    /** Возвращает новое содержимое изменённых файлов (LinkedHashMap, порядок сохраняется). */
    Map<String, String> apply(Map<String, String> files, String target);
}
