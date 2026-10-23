package blueprints.testing.junit;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * jar {@code junit-platform-console-standalone} (версия — в libs.versions.toml). Лежит в ресурсах модуля (кладёт Gradle),
 * при первом обращении копируется во временный файл: им компилируются тесты (там же jupiter-api) и он же монтируется
 * в контейнер read-only. В рантайме ничего не скачивается.
 */
final class LauncherJar {
    static final String RESOURCE = "/blueprints/testing/junit/junit-platform-console-standalone.jar";
    private static Path path;

    private LauncherJar() {
    }

    static synchronized Path path() {
        if (path != null && Files.isRegularFile(path)) return path;
        try (InputStream in = LauncherJar.class.getResourceAsStream(RESOURCE)) {
            if (in == null) throw new IllegalStateException("Нет ресурса " + RESOURCE + " (сборка testing без junitLauncher)");
            Path dir = Files.createTempDirectory("blueprints-junit");
            Path jar = dir.resolve("junit-platform-console-standalone.jar");
            Files.copy(in, jar, StandardCopyOption.REPLACE_EXISTING);
            jar.toFile().deleteOnExit();
            dir.toFile().deleteOnExit();
            path = jar;
            return jar;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
