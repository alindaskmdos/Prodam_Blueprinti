package blueprints.cli;

import blueprints.analysis.DetectorRegistry;
import blueprints.analysis.MethodAnalysis;
import blueprints.analysis.ProjectAnalysis;
import blueprints.model.Issue;
import blueprints.source.LoadException;
import blueprints.source.LoadedProject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.io.PrintWriter;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.Callable;
import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.Spec;

/** {@code analyze <проект> [--fail-on O(n^2)] [--format json|text]}: проблемы и сложность методов (как GET /analysis). */
@Command(name = "analyze", mixinStandardHelpOptions = true, description = "Проблемы и сложность методов.")
final class Analyze implements Callable<Integer> {
    enum Format { json, text }

    /** Поля MethodMetrics контракта. */
    record Metrics(String methodId, String complexity, int lines, int maxNesting) {}

    /** Analysis контракта без version: у CLI нет версий проекта. Issue — без blockId и fixes (нужны только редактору). */
    record Report(long n, List<Issue> issues, List<Metrics> metrics) {}

    @Spec
    CommandSpec spec;

    @Parameters(paramLabel = "<проект>", description = "папка проекта или .zip/.jar")
    Path project;

    @Option(names = "--fail-on", paramLabel = "<O(...)>", converter = Rank.Converter.class,
            description = "код выхода 1, если сложность хоть одного метода не меньше заданной, например \"O(n^2)\"")
    Rank failOn;

    @Option(names = "--format", defaultValue = "text", description = "json | text (по умолчанию ${DEFAULT-VALUE})")
    Format format;

    @Override
    public Integer call() throws Exception {
        PrintWriter out = spec.commandLine().getOut(), err = spec.commandLine().getErr();
        LoadedProject p;
        try {
            p = Cli.load(project);
        } catch (LoadException e) {
            err.println("проект не загружен (" + e.code() + "): " + e.getMessage());
            return Cli.LOAD_ERROR;
        }
        ProjectAnalysis a = ProjectAnalysis.of(p.files());
        List<Issue> issues = DetectorRegistry.defaults().run(a);
        a.warnings().forEach(w -> err.println("предупреждение: " + w));

        if (format == Format.json) {
            List<Metrics> metrics = a.methods().stream()
                    .map(m -> new Metrics(m.id(), m.complexity().toString(), m.lines(), m.maxNesting())).toList();
            out.println(new ObjectMapper().setSerializationInclusion(JsonInclude.Include.NON_NULL)
                    .enable(SerializationFeature.INDENT_OUTPUT).writeValueAsString(new Report(a.n(), issues, metrics)));
        } else {
            for (Issue i : issues) {
                String where = i.span() == null ? i.methodId() : i.span().file() + ":" + i.span().startLine();
                String cx = i.complexity() == null || i.complexity().before() == null ? ""
                        : "  [" + i.complexity().before() + " → " + i.complexity().after() + "]";
                out.println(where + "  " + i.severity() + "/" + i.confidence() + "  " + i.rule() + "  " + i.message() + cx);
            }
            String worst = a.methods().stream().max(Comparator.comparing((MethodAnalysis m) -> Rank.of(m.complexity())))
                    .map(m -> ". Старшая сложность: " + m.complexity() + " — " + m.id()).orElse("");
            out.println("Методов: " + a.methods().size() + ", проблем: " + issues.size() + worst);
        }
        out.flush();

        if (failOn == null) return Cli.OK;
        List<MethodAnalysis> over = a.methods().stream().filter(m -> Rank.of(m.complexity()).compareTo(failOn) >= 0).toList();
        if (over.isEmpty()) return Cli.OK;
        err.println("--fail-on: сложность не ниже заданной в " + over.size() + " метод(ах):");
        over.forEach(m -> err.println("  " + m.id() + "  " + m.complexity()));
        err.flush();
        return Cli.VIOLATION;
    }
}
