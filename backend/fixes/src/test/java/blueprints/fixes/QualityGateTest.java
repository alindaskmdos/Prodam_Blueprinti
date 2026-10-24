package blueprints.fixes;

import static org.junit.jupiter.api.Assertions.*;

import blueprints.testing.BehaviorVerifier;
import blueprints.testing.TestContext;
import blueprints.testing.TestResult;
import blueprints.testing.TestStatus;
import blueprints.testing.VerifyResult;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import javax.tools.JavaCompiler;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
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

    /** Фикс, который пытается записать в карту проекта: отказ, вход не меняется. */
    @Test
    void fixGetsReadOnlyFiles() {
        Map<String, String> files = new LinkedHashMap<>(project);
        Refactoring sneaky = new Refactoring() {
            public String id() {
                return "sneaky";
            }

            public boolean canApply(Map<String, String> f, String target) {
                return true;
            }

            public Map<String, String> apply(Map<String, String> f, String target) {
                f.put(target, FIXED);
                return Map.of(target, FIXED);
            }
        };
        QualityGate.Result r = gate(VerifyResult.Status.GREEN, List.of()).apply(files, files, null, sneaky, MAIN);
        assertFalse(r.applied());
        assertTrue(r.reason().startsWith("исправление не подтверждено: ошибка фикса sneaky"), r.reason());
        assertEquals(Map.of(MAIN, ORIGINAL), files);
        assertTrue(calls.isEmpty());
    }

    @Test
    void noSystemCompilerRejectsWithReason() {
        QualityGate.Result r = new QualityGate(ctx -> {
            calls.add(ctx);
            return new VerifyResult(VerifyResult.Status.GREEN, List.of(), List.of());
        }, () -> null).apply(project, project, null, new Replace(FIXED), MAIN);
        assertFalse(r.applied());
        assertEquals("исправление не подтверждено: " + QualityGate.NO_COMPILER, r.reason());
        assertNull(r.verify());
        assertTrue(calls.isEmpty());
    }

    /** Файловый менеджер javac закрывается — и при успехе, и при ошибке компиляции. */
    @Test
    void fileManagerIsClosed() {
        JavaCompiler real = ToolProvider.getSystemJavaCompiler();
        AtomicInteger opened = new AtomicInteger(), closed = new AtomicInteger();
        JavaCompiler counting = (JavaCompiler) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[] {JavaCompiler.class}, (p, method, args) -> {
                    Object res = invoke(real, method, args);
                    if (!method.getName().equals("getStandardFileManager")) return res;
                    opened.incrementAndGet();
                    return Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {StandardJavaFileManager.class},
                            (p2, m2, a2) -> {
                                if (m2.getName().equals("close")) closed.incrementAndGet();
                                return invoke(res, m2, a2);
                            });
                });
        QualityGate g = new QualityGate(ctx -> new VerifyResult(VerifyResult.Status.GREEN, List.of(), List.of()), () -> counting);
        assertTrue(g.apply(project, project, null, new Replace(FIXED), MAIN).applied());
        assertFalse(g.apply(project, project, null, new Replace("class Main { int x = ; }"), MAIN).applied());
        assertEquals(2, opened.get());
        assertEquals(2, closed.get());
    }

    private static Object invoke(Object target, Method m, Object[] args) throws Throwable {
        try {
            return m.invoke(target, args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }
}
