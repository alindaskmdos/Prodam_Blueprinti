package blueprints.cli;

import blueprints.runner.Runner;
import blueprints.source.LoadException;
import blueprints.source.LoadedProject;
import blueprints.testing.BehaviorVerifier;
import blueprints.testing.TestContext;
import blueprints.testing.TestResult;
import blueprints.testing.TestSourceRegistry;
import blueprints.testing.VerifyResult;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.io.PrintWriter;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.TimeUnit;
import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.Spec;

/**
 * {@code verify <проект> [--format json|text]}: тесты проекта (tests/*.in/.out/.json, tests/*.java) в Docker, как POST /verify.
 * У CLI нет правок, поэтому оригинал = текущая версия: original-тесты сверяют программу с собой (детерминизм), manual — с expected.
 */
@Command(name = "verify", mixinStandardHelpOptions = true, description = "Прогон тестов проекта в Docker.")
final class Verify implements Callable<Integer> {
    /** TestResult контракта. */
    record Result(String name, String type, String status, long durationMs, String error, String expected, String actual,
                  List<Integer> noisyLines) {}

    /** VerifyResult контракта. */
    record Report(String status, List<Result> results, List<String> warnings) {}

    @Spec
    CommandSpec spec;

    @Parameters(paramLabel = "<проект>", description = "папка проекта или .zip/.jar")
    Path project;

    @Option(names = "--format", defaultValue = "text", description = "json | text (по умолчанию ${DEFAULT-VALUE})")
    Analyze.Format format;

    @Override
    public Integer call() throws Exception {
        PrintWriter out = spec.commandLine().getOut(), err = spec.commandLine().getErr();
        Map<String, String> files = new LinkedHashMap<>();
        try {
            LoadedProject p = Cli.load(project);
            p.files().forEach(f -> files.put(f.path(), f.text()));
            p.testFiles().forEach((k, v) -> files.put(k, new String(v, StandardCharsets.UTF_8)));
        } catch (LoadException e) {
            err.println("проект не загружен (" + e.code() + "): " + e.getMessage());
            return Cli.LOAD_ERROR;
        }
        if (!dockerUp()) {
            err.println("Docker недоступен (docker info не прошёл): verify запускает тесты только в контейнере");
            return Cli.SANDBOX_ERROR;
        }
        Runner runner = new Runner(Runner.Config.defaults());
        VerifyResult v;
        try {
            v = new BehaviorVerifier(TestSourceRegistry.defaults(runner), runner).verify(new TestContext(files, files, null));
        } catch (IllegalArgumentException e) { // несколько main-классов
            err.println("проект не запускается: " + e.getMessage());
            return Cli.LOAD_ERROR;
        } catch (IllegalStateException | UncheckedIOException e) {
            err.println("сбой песочницы: " + e.getMessage());
            return Cli.SANDBOX_ERROR;
        }

        Report r = new Report(v.status().wire(), v.results().stream().map(Verify::result).toList(), v.warnings());
        if (format == Analyze.Format.json) {
            out.println(new ObjectMapper().setSerializationInclusion(JsonInclude.Include.NON_NULL)
                    .enable(SerializationFeature.INDENT_OUTPUT).writeValueAsString(r));
        } else {
            for (Result t : r.results()) {
                out.println(t.status() + "  " + t.name() + " (" + t.type() + ", " + t.durationMs() + " мс)"
                        + (t.error() == null || t.error().isEmpty() ? "" : ": " + t.error()));
            }
            r.warnings().forEach(w -> out.println("предупреждение: " + w));
            out.println("Проверка: " + r.status() + ", тестов: " + r.results().size());
        }
        out.flush();
        // incomplete (тестов нет, шум) — не нарушение: ничего не упало
        return v.status() == VerifyResult.Status.RED || v.status() == VerifyResult.Status.BLOCKED ? Cli.VIOLATION : Cli.OK;
    }

    private static Result result(TestResult t) {
        return new Result(t.name(), t.type(), t.status().wire(), t.durationMs(), t.error(), t.expected(), t.actual(), t.noisyLines());
    }

    /** Команда docker для проверки доступности; тест подменяет на несуществующую. */
    static String dockerBinary = "docker";

    static boolean dockerUp() {
        try {
            Process p = new ProcessBuilder(dockerBinary, "info").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            if (!p.waitFor(30, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return false;
            }
            return p.exitValue() == 0;
        } catch (Exception e) {
            return false;
        }
    }
}
