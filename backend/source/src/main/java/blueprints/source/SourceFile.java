package blueprints.source;

import java.nio.charset.StandardCharsets;

/** Исходник проекта: path как в архиве (после отрезания обёртки), пакет из объявления, байты как загружены. */
public record SourceFile(String path, String pkg, byte[] content) {
    public String text() {
        return new String(content, StandardCharsets.UTF_8);
    }
}
