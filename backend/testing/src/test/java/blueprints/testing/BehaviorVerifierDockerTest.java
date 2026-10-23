package blueprints.testing;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import blueprints.runner.Runner;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Весь verify на реальном Docker. Пропускается, если docker info не проходит. */
class BehaviorVerifierDockerTest {

    /** Строки: 1 — hostname контейнера, 2 — new Random() (seed → детерминирована), 3 — время (шумная), 4 — константа. */
    private static final String MAIN = """
            public class Main {
                public static void main(String[] a) throws Exception {
                    // %s
                    System.out.println("host=" + java.nio.file.Files.readString(java.nio.file.Path.of("/etc/hostname")).trim());
                    System.out.println("rnd=" + new java.util.Random().nextInt(1_000_000));
                    System.out.println("t=" + System.nanoTime());
                    System.out.println("end");
                }
            }
            """;
    /** Падает с сообщением = hostname контейнера: так видно, где выполнился JUnit. */
    private static final String JUNIT = """
            import static org.junit.jupiter.api.Assertions.fail;
            import org.junit.jupiter.api.Disabled;
            import org.junit.jupiter.api.Test;
            class MainTest {
                @Test void host() throws Exception {
                    fail(java.nio.file.Files.readString(java.nio.file.Path.of("/etc/hostname")).trim());
                }
                @Disabled("потом") @Test void later() {}
            }
            """;

    private static boolean dockerUp() {
        try {
            Process p = new ProcessBuilder("docker", "info").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            return p.waitFor() == 0;
        } catch (Exception e) {
            return false;
        }
    }

    /** Реальный Runner (Rewrite.RUN) и счётчик пакетов: один пакет = один контейнер (см. RunnerTest). */
    private static final class Counting implements BehaviorVerifier.BatchRunner {
        final Runner runner;
        final List<Integer> batches = new ArrayList<>();

        Counting(Path tmp) {
            assumeTrue(dockerUp(), "docker недоступен");
            var d = Runner.Config.defaults();
            runner = new Runner(new Runner.Config(tmp, d.image(), d.memory(), d.cpus(), Duration.ofSeconds(10)));
        }

        @Override
        public List<Runner.RunResult> runBatch(List<Runner.Program> programs, List<Runner.Job> jobs, Map<String, Path> files) {
            batches.add(jobs.size());
            return runner.runBatch(programs, jobs, Runner.Rewrite.RUN, files);
        }

        BehaviorVerifier verifier() {
            return new BehaviorVerifier(TestSourceRegistry.defaults(runner), this);
        }
    }

    private static TestContext ctx(String orig, String cur, Map<String, String> tests) {
        Map<String, String> current = new LinkedHashMap<>(Map.of("src/Main.java", cur));
        current.putAll(tests);
        return new TestContext(Map.of("src/Main.java", orig), current, "Main");
    }

    @Test
    void ioAndJUnitInOneContainerWithNoisyLine(@TempDir Path tmp) {
        Counting runner = new Counting(tmp);
        VerifyResult r = runner.verifier().verify(ctx(MAIN.formatted("orig"), MAIN.formatted("cur"),
                Map.of("tests/run.in", "", "tests/MainTest.java", JUNIT)));
        assertEquals(List.of(4), runner.batches, "один пакет: IO текущая + оригинал дважды + JUnit");

        TestResult io = r.results().get(0);
        assertEquals("run", io.name());
        assertEquals(TestStatus.PASSED, io.status(), io.toString());
        assertEquals(List.of(3), io.noisyLines(), "время — шумная строка; new Random() с seed в обеих версиях — нет");
        String host = io.actual().lines().findFirst().orElseThrow().substring("host=".length());
        assertFalse(host.isBlank());
        assertEquals("host=" + host, io.expected().lines().findFirst().orElseThrow(), "оригинал — в том же контейнере");

        TestResult junit = r.results().stream().filter(t -> t.name().equals("MainTest.host")).findFirst().orElseThrow();
        assertEquals(TestStatus.FAILED, junit.status());
        assertEquals(host, junit.error(), "JUnit — в том же контейнере, что и IO");
        assertTrue(r.results().stream().anyMatch(t -> t.name().equals("MainTest.later") && t.skipped()), r.toString());
        assertEquals(VerifyResult.Status.RED, r.status());
        assertEquals(List.of("1 тест пропущен (@Disabled)"), r.warnings());
    }

    @Test
    void mostlyNoisyProgramIsIncomplete(@TempDir Path tmp) {
        String code = """
                public class Main {
                    public static void main(String[] a) {
                        System.out.println(System.nanoTime());
                        System.out.println(System.identityHashCode(new Object()) ^ System.nanoTime());
                        System.out.println("ok");
                    }
                }
                """;
        Counting runner = new Counting(tmp);
        VerifyResult r = runner.verifier().verify(ctx(code, code, Map.of("tests/a.in", "")));
        assertEquals(List.of(1, 2), r.results().get(0).noisyLines(), r.toString());
        assertEquals(TestStatus.PASSED, r.results().get(0).status());
        assertEquals(VerifyResult.Status.INCOMPLETE, r.status());
        assertEquals(List.of(BehaviorVerifier.WARN_NOISY), r.warnings());
        assertEquals(1, runner.batches.size());
    }

    @Test
    void stdinProgramWithInputTestIsGreen(@TempDir Path tmp) {
        String code = """
                import java.util.Scanner;
                public class Main {
                    public static void main(String[] a) {
                        Scanner in = new Scanner(System.in);
                        int s = 0;
                        while (in.hasNextInt()) s += in.nextInt();
                        System.out.println("sum=" + s);
                    }
                }
                """;
        Counting runner = new Counting(tmp);
        VerifyResult r = runner.verifier().verify(ctx(code, code.replace("int s = 0;", "long s = 0L;"),
                Map.of("tests/sum.in", "1 2 3\n", "tests/sum.out", "sum=6\n")));
        assertEquals(VerifyResult.Status.GREEN, r.status(), r.toString());
        assertEquals(List.of(), r.results().get(0).noisyLines());
    }
}
