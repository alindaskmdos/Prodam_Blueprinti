package blueprints.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
import blueprints.source.SourceFile;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Прогон по samples/detectors и samples/spaghetti: для каждого правила BE-50…BE-55 находки
 * (метод:строка:severity/confidence) совпадают с заложенными в примерах ровно — позитивы найдены, на негативах
 * («не находка» в исходниках) правило молчит.
 */
class DetectorsSampleTest {
    private static List<Issue> detectors;
    private static List<Issue> spaghetti;

    @BeforeAll
    static void analyze() throws IOException {
        detectors = run("detectors");
        spaghetti = run("spaghetti");
    }

    private static List<Issue> run(String sample) throws IOException {
        ProjectAnalysis p = ProjectAnalysis.of(files(sample));
        assertTrue(p.warnings().isEmpty(), p.warnings().toString());
        return DetectorRegistry.defaults().run(p);
    }

    @Test
    void emptyCatch() {
        assertEquals(List.of(
                "ConfigLoader.port~0:27:medium/high",
                "ConfigLoader.retries~0:37:medium/low",
                "ConfigLoader.workerPorts~0:51:medium/high"), found(detectors, "EmptyCatch"));
    }

    @Test
    void catchBug() {
        assertEquals(List.of(
                "OrderImporter.customerOf~0:20:medium/high",
                "OrderImporter.cityOf~0:30:medium/high",
                "OrderImporter.importAll~0:44:high/high"), found(detectors, "CatchBug"));
    }

    @Test
    void ignoredResult() {
        assertEquals(List.of(
                "InvoiceService.header~0:13:high/high",
                "InvoiceService.totalWithTax~0:21:high/high",
                "InvoiceService.dueDate~0:28:high/high"), found(detectors, "IgnoredResult"));
    }

    @Test
    void referenceEquality() {
        assertEquals(List.of(
                "StockChecker.integerCache~0:23:high/high",
                "StockChecker.integerCache~0:24:high/high",
                "StockChecker.matches~0:30:high/high",
                "StockChecker.isReserved~0:37:high/high"), found(detectors, "ReferenceEquality"));
    }

    @Test
    void newRulesSilentOnTheOtherSample() {
        for (String rule : List.of("EmptyCatch", "CatchBug", "IgnoredResult", "ReferenceEquality")) {
            assertEquals(List.of(), found(spaghetti, rule), rule);
        }
        assertEquals(List.of(), found(detectors, "LongMethod"));
        assertEquals(List.of(), found(detectors, "LongLine"));
    }

    @Test
    void longMethodAndLongLineOnHumanSpaghettiExample() {
        assertEquals(List.of("SpaghettiCodeExample.processComplexPipeline~0:15:low/high"), found(spaghetti, "LongMethod"));
        assertEquals(List.of("SpaghettiCodeExample.processComplexPipeline~0:39:low/high"), found(spaghetti, "LongLine"));
        Issue line = spaghetti.stream().filter(i -> i.rule().equals("LongLine")).findFirst().orElseThrow();
        assertTrue(line.message().contains("строк длиннее порога в методе: 4"), line.message());
    }

    private static List<String> found(List<Issue> issues, String rule) {
        return issues.stream().filter(i -> i.rule().equals(rule))
                .map(i -> i.methodId() + ":" + i.span().startLine() + ":" + i.severity() + "/" + i.confidence())
                .toList();
    }

    static List<SourceFile> files(String sample) throws IOException {
        List<SourceFile> files = new ArrayList<>();
        Path root = Path.of("../../samples/" + sample + "/src");
        try (Stream<Path> s = Files.walk(root)) {
            for (Path f : s.filter(x -> x.toString().endsWith(".java")).sorted().toList()) {
                files.add(new SourceFile("src/" + root.relativize(f).toString().replace('\\', '/'), "",
                        Files.readAllBytes(f)));
            }
        }
        assertTrue(!files.isEmpty(), "samples/" + sample + " не найден");
        return files;
    }
}
