package blueprints.fixes;

import static org.junit.jupiter.api.Assertions.*;

import blueprints.testing.BehaviorVerifier;
import blueprints.testing.TestContext;
import blueprints.testing.TestResult;
import blueprints.testing.TestStatus;
import blueprints.testing.VerifyResult;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Quality Gate: настоящая компиляция, вердикт проверки поведения подменён (без Docker). */
class QualityGateTest {

    private static final String MAIN = "src/Main.java";
    private static final String ORIGINAL = "class Main { public static void main(String[] a) { System.out.println(1); } }";
    private static final String FIXED = "class Main { public static void main(String[] a) { System.out.println(2); } }";

    /** Фикс: заменяет файл target на заданный текст. */
    private record Replace(String text) implements Refactoring {
        public String id() {
            return "replace";
        }

        public boolean canApply(Map<String, String> files, String target) {
            return files.containsKey(target);
        }

        public Map<String, String> apply(Map<String, String> files, String target) {
            return new LinkedHashMap<>(Map.of(target, text));
        }
    }

    private final Map<String, String> project = Map.of(MAIN, ORIGINAL);
    private final List<TestContext> calls = new ArrayList<>();

    private QualityGate gate(VerifyResult.Status status, List<String> warnings, TestResult... results) {
        return new QualityGate(ctx -> {
            calls.add(ctx);
            return new VerifyResult(status, List.of(results), warnings);
        });
    }

    private static TestResult result(String name, TestStatus status, String error) {
        return new TestResult(name, "io", status, 5, error, null, null, List.of());
    }

    @Test
    void greenApplies() {
        QualityGate.Result r = gate(VerifyResult.Status.GREEN, List.of(), result("basic", TestStatus.PASSED, null))
                .apply(project, project, "Main", new Replace(FIXED), MAIN);
        assertTrue(r.applied());
        assertNull(r.reason());
        assertEquals(Map.of(MAIN, FIXED), r.changed());
        assertEquals(VerifyResult.Status.GREEN, r.verify().status());
        assertEquals(FIXED, calls.get(0).currentFiles().get(MAIN));
        assertEquals(ORIGINAL, calls.get(0).originalFiles().get(MAIN));
        assertEquals("Main", calls.get(0).mainClass());
    }

    @Test
    void redRejectsAndKeepsSources() {
        Map<String, String> files = new LinkedHashMap<>(project);
        QualityGate.Result r = gate(VerifyResult.Status.RED, List.of(), result("basic", TestStatus.PASSED, null),
                result("merge", TestStatus.FAILED, "diff"), result("T", TestStatus.COMPILE_ERROR, "x"))
                .apply(files, files, null, new Replace(FIXED), MAIN);
        assertFalse(r.applied());
        assertEquals("исправление не подтверждено: тест merge не проходит после фикса; тест T не компилируется",
                r.reason());
        assertTrue(r.changed().isEmpty());
        assertEquals(VerifyResult.Status.RED, r.verify().status());
        assertEquals(Map.of(MAIN, ORIGINAL), files);
    }

    @Test
    void compileErrorRejectsBeforeTests() {
        QualityGate.Result r = gate(VerifyResult.Status.GREEN, List.of())
                .apply(project, project, null, new Replace("class Main { int x = ; }"), MAIN);
        assertFalse(r.applied());
        assertTrue(r.reason().startsWith("исправление не подтверждено: код не компилируется после фикса: src/Main.java:1: "),
                r.reason());
        assertNull(r.verify());
        assertTrue(calls.isEmpty());
    }

    @Test
    void testsDirIsNotCompiledByGate() {
        Map<String, String> files = Map.of(MAIN, ORIGINAL, "tests/MainTest.java", "import org.junit.jupiter.api.Test;");
        assertTrue(gate(VerifyResult.Status.GREEN, List.of()).apply(files, files, null, new Replace(FIXED), MAIN).applied());
    }

    @Test
    void noTestsAppliesWithNote() {
        QualityGate.Result r = gate(VerifyResult.Status.INCOMPLETE, List.of(BehaviorVerifier.WARN_NO_TESTS))
                .apply(project, project, null, new Replace(FIXED), MAIN);
        assertTrue(r.applied());
        assertEquals(QualityGate.NO_TESTS_NOTE, r.reason());
        assertEquals(Map.of(MAIN, FIXED), r.changed());
    }

    @Test
    void noisyAppliesWithNote() {
        QualityGate.Result r = gate(VerifyResult.Status.INCOMPLETE, List.of(BehaviorVerifier.WARN_NOISY),
                result("basic", TestStatus.PASSED, null)).apply(project, project, null, new Replace(FIXED), MAIN);
        assertTrue(r.applied());
        assertEquals(QualityGate.INCOMPLETE_NOTE + ": " + BehaviorVerifier.WARN_NOISY, r.reason());
    }

    @Test
    void blockedRejects() {
        QualityGate.Result r = gate(VerifyResult.Status.BLOCKED, List.of(BehaviorVerifier.WARN_STDIN))
                .apply(project, project, null, new Replace(FIXED), MAIN);
        assertFalse(r.applied());
        assertEquals("исправление не подтверждено: " + BehaviorVerifier.WARN_STDIN, r.reason());
    }

    @Test
    void notApplicableAndThrowingFixAreRejected() {
        QualityGate g = gate(VerifyResult.Status.GREEN, List.of());
        assertFalse(g.apply(project, project, null, new Replace(FIXED), "src/Other.java").applied());
        QualityGate.Result r = g.apply(project, project, null, new Refactoring() {
            public String id() {
                return "boom";
            }

            public boolean canApply(Map<String, String> files, String target) {
                return true;
            }

            public Map<String, String> apply(Map<String, String> files, String target) {
                throw new IllegalStateException("сломался");
            }
        }, MAIN);
        assertFalse(r.applied());
        assertEquals("исправление не подтверждено: ошибка фикса boom: сломался", r.reason());
        assertTrue(calls.isEmpty());
    }
}
