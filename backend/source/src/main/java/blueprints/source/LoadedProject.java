package blueprints.source;

import java.util.List;
import java.util.Map;

/**
 * Результат загрузки. root — отрезанная общая верхняя папка ("" или "demo/"), экспорт пишет root + path.
 * testFiles — сырые файлы tests/** (.java/.json/.in/.out) по путям, разбор в TestCase делает app.
 */
public record LoadedProject(
        String root,
        List<SourceFile> files,
        List<LoadWarning> warnings,
        Map<String, byte[]> testFiles,
        List<String> mainClasses) {}
