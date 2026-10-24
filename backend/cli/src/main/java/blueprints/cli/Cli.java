package blueprints.cli;

import blueprints.source.LoadException;
import blueprints.source.LoadedProject;
import blueprints.source.ProjectLoader;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.ParameterException;
import picocli.CommandLine.Spec;

/** CLI для CI (§14а.11): {@code blueprints analyze|verify <проект>}. Коды выхода — константы ниже (2 — ошибка аргументов, picocli). */
@Command(name = "blueprints", mixinStandardHelpOptions = true, subcommands = {Analyze.class, Verify.class},
        description = "Анализ и проверка Java-проекта без сервера.")
public final class Cli implements Runnable {
    public static final int OK = 0;
    /** --fail-on превышен / проверка поведения не прошла. */
    public static final int VIOLATION = 1;
    /** Проект не найден или не загружается (ошибка ProjectLoader, несколько main). */
    public static final int LOAD_ERROR = 3;
    /** Песочница недоступна: нет Docker, контейнер не стартовал. */
    public static final int SANDBOX_ERROR = 4;
    /** Необработанное исключение команды (не нарушение и не ввод-вывод). */
    public static final int INTERNAL_ERROR = 5;

    @Spec
    CommandSpec spec;

    @Override
    public void run() {
        throw new ParameterException(spec.commandLine(), "укажите команду: analyze или verify");
    }

    public static void main(String[] args) {
        System.exit(commandLine().execute(args));
    }

    /** Команда с кодами выхода: исключение команды — не 1 (по умолчанию у picocli), а {@link #exitCode(Exception)}. */
    public static CommandLine commandLine() {
        return new CommandLine(new Cli()).setExecutionExceptionHandler((e, cl, parsed) -> {
            cl.getErr().println("ошибка: " + e);
            cl.getErr().flush();
            return exitCode(e);
        });
    }

    static int exitCode(Exception e) {
        return e instanceof IOException || e instanceof UncheckedIOException ? LOAD_ERROR : INTERNAL_ERROR;
    }

    /** Папка проекта или .zip/.jar — через тот же {@link ProjectLoader}, что POST /projects. */
    static LoadedProject load(Path path) throws IOException {
        if (Files.isRegularFile(path)) {
            return ProjectLoader.load(List.of(new ProjectLoader.Upload(path.getFileName().toString(), Files.readAllBytes(path))));
        }
        if (!Files.isDirectory(path)) throw new LoadException("NOT_FOUND", "нет такого файла или папки: " + path);
        List<ProjectLoader.Upload> ups = new ArrayList<>();
        try (Stream<Path> s = Files.walk(path)) {
            for (Path p : s.filter(Files::isRegularFile).sorted().toList()) {
                String rel = path.relativize(p).toString().replace('\\', '/');
                // загрузчику нужны только .java и tests/; .git, .idea и т.п. не читаются (лимит 2000 файлов / 20 МБ)
                if (rel.startsWith(".") || rel.contains("/.")) continue;
                if (rel.endsWith(".java") || rel.startsWith("tests/")) ups.add(new ProjectLoader.Upload(rel, Files.readAllBytes(p)));
            }
        }
        return ProjectLoader.load(ups);
    }
}
