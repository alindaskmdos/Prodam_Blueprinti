package blueprints.testing.io;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import blueprints.runner.Runner;
import blueprints.testing.TestContext;
import blueprints.testing.TestResult;
import blueprints.testing.TestStatus;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Интеграция с реальным Docker на программах из samples/roundtrip. Пропускается, если docker info не проходит. */
class IoTestSourceDockerTest {

    private static final Path SAMPLES = Path.of("../../samples/roundtrip").toAbsolutePath().normalize();

    private static boolean dockerUp() {
        try {
            Process p = new ProcessBuilder("docker", "info").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            return p.waitFor() == 0;
        } catch (Exception e) {
            return false;
        }
    }

    /** Источник поверх реального Runner; считает пакеты (один пакет = один контейнер, см. RunnerTest). */
    private static final class Counting implements IoTestSource.BatchRunner {
        final Runner runner;
        final List<Integer> batches = new ArrayList<>();

        Counting(Path tmp) {
            assumeTrue(dockerUp(), "docker недоступен");
            assumeTrue(Files.isDirectory(SAMPLES), "samples/roundtrip не найден");
            var d = Runner.Config.defaults();
            runner = new Runner(new Runner.Config(tmp, d.image(), d.memory(), d.cpus(), Duration.ofSeconds(10)));
        }

        @Override
        public List<Runner.RunResult> runBatch(List<Runner.Program> programs, List<Runner.Job> jobs) {
            batches.add(jobs.size());
            return runner.runBatch(programs, jobs, Runner.Rewrite.RUN);
        }
    }

    private static String sample(String file) throws Exception {
        return Files.readString(SAMPLES.resolve(file));
    }

    private static Map<String, String> project(String className, String code, Map<String, String> tests) {
        Map<String, String> files = new HashMap<>(tests);
        files.put("src/" + className + ".java", code);
        return files;
    }

    @Test
    void scannerInputWithInOutPairManualAndOriginalModes(@TempDir Path tmp) throws Exception {
        Counting runner = new Counting(tmp);
        String code = sample("ScannerInput.java");
        String in = sample("ScannerInput.in");
        Map<String, String> tests = Map.of(
                "tests/scan.in", in,
                "tests/scan.out", sample("expected/ScannerInput.out"),
                "tests/orig.json", IoTestFiles.toJson(new IoTestCase("orig", in, IoTestCase.Mode.ORIGINAL, null, List.of())),
                "tests/wrong.json", IoTestFiles.toJson(new IoTestCase("wrong", in, IoTestCase.Mode.MANUAL, "nope\n", List.of())));
        var source = new IoTestSource(runner, new OutputComparator());

        // неизменённая программа: всё зелёное, кроме заведомо неверного manual-теста
        var same = source.run(new TestContext(project("ScannerInput", code, tests), project("ScannerInput", code, tests), null));
        assertEquals(Map.of("orig", TestStatus.PASSED, "scan", TestStatus.PASSED, "wrong", TestStatus.ORIGINAL_FAILS),
                statuses(same), same.toString());
        assertEquals(List.of(6), runner.batches, "один пакет (контейнер) на прогон: 3 теста × 2 версии");

        // изменённое поведение: original и manual краснеют, на первой строке
        String changed = code.replace("\"sum=\"", "\"total=\"");
        var diff = source.run(new TestContext(project("ScannerInput", code, tests), project("ScannerInput", changed, tests), null));
        assertEquals(Map.of("orig", TestStatus.FAILED, "scan", TestStatus.FAILED, "wrong", TestStatus.ORIGINAL_FAILS), statuses(diff));
        TestResult fixedCheck = source.run(new TestContext(project("ScannerInput", changed, tests), project("ScannerInput", code, tests), null))
                .stream().filter(r -> r.name().equals("scan")).findFirst().orElseThrow();
        assertEquals(TestStatus.PASSED, fixedCheck.status());
        assertEquals(IoTestSource.FIXED_BY_EDIT, fixedCheck.error());
        TestResult orig = diff.stream().filter(r -> r.name().equals("orig")).findFirst().orElseThrow();
        assertTrue(orig.error().startsWith("stdout, строка 1"), orig.error());
        assertTrue(orig.expected().startsWith("sum=") && orig.actual().startsWith("total="));
    }

    @Test
    void exitCodeAndExceptionWithoutStackTrace(@TempDir Path tmp) throws Exception {
        Counting runner = new Counting(tmp);
        var source = new IoTestSource(runner, new OutputComparator());
        Map<String, String> tests = Map.of("tests/run.json", "{}");

        String exit = sample("SystemExit.java");
        var exitSame = source.run(new TestContext(project("SystemExit", exit, tests), project("SystemExit", exit, tests), null));
        assertEquals(TestStatus.PASSED, exitSame.get(0).status(), exitSame.toString());
        var exitChanged = source.run(new TestContext(project("SystemExit", exit, tests),
                project("SystemExit", exit.replace("System.exit(3)", "System.exit(4)"), tests), null));
        assertEquals("код выхода: ожидался 3, получен 4", exitChanged.get(0).error());

        String unc = sample("UncaughtException.java");
        // другие номера строк в stack trace — поведение то же
        String shifted = unc.replace("    static int validate(int age) {", "\n\n    static int validate(int age) {");
        var trace = source.run(new TestContext(project("UncaughtException", unc, tests), project("UncaughtException", shifted, tests), null));
        assertEquals(TestStatus.PASSED, trace.get(0).status(), trace.toString());
        var msg = source.run(new TestContext(project("UncaughtException", unc, tests),
                project("UncaughtException", unc.replace("age must be >= 0", "age must be positive"), tests), null));
        assertEquals(TestStatus.FAILED, msg.get(0).status());
        assertTrue(msg.get(0).error().startsWith("исключение: ожидалось «UncaughtException$ValidationException: age must be >= 0"),
                msg.get(0).error());
    }

    private static Map<String, TestStatus> statuses(List<TestResult> rs) {
        Map<String, TestStatus> m = new HashMap<>();
        rs.forEach(r -> m.put(r.name(), r.status()));
        return m;
    }
}
