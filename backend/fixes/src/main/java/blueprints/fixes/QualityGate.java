package blueprints.fixes;

import blueprints.testing.BehaviorVerifier;
import blueprints.testing.TestContext;
import blueprints.testing.TestResult;
import blueprints.testing.TestStatus;
import blueprints.testing.VerifyResult;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Stream;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.ToolProvider;

/**
 * Quality Gate (§9): патч {@link Refactoring} → компиляция программы → все тесты ({@link BehaviorVerifier}).
 * Входные файлы не меняются никогда: «откат» = патч просто не возвращается ({@code applied=false}).
 * <p>
 * Вердикт: {@code blocked}/{@code red} → отклонить; {@code incomplete} → применить с пометкой в {@code reason}
 * (нет тестов — «подтверждена компиляция, тестов нет»; шум/нестабильный оригинал — непрошедших тестов нет, неполнота
 * только в шумных строках, отклонение сделало бы фиксы невозможными для программ с временем/случайностью в выводе);
 * {@code green} → применить.
 */
public final class QualityGate {

    public static final String NOT_CONFIRMED = "исправление не подтверждено";
    public static final String NO_TESTS_NOTE = "подтверждена компиляция, тестов нет";
    public static final String INCOMPLETE_NOTE = "применено, проверка неполная";

    /**
     * Итог Quality Gate в форме контрактного {@code FixResult} без {@code version}/{@code diff}/{@code mutation} —
     * их добавляет app (версии проекта и diff по {@code changed}).
     *
     * @param reason  при отклонении — «исправление не подтверждено: …»; при применении с неполной проверкой — пометка; иначе null
     * @param changed новое содержимое изменённых файлов (только при {@code applied}, иначе пусто)
     * @param verify  результат проверки; null, если до тестов не дошло (фикс неприменим или не компилируется)
     */
    public record Result(boolean applied, String reason, Map<String, String> changed, VerifyResult verify) {
        public Result {
            changed = changed == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(changed));
        }

        static Result rejected(String why, VerifyResult verify) {
            return new Result(false, NOT_CONFIRMED + ": " + why, Map.of(), verify);
        }
    }

    public static final String NO_COMPILER = "нет системного компилятора Java (запущено на JRE, нужен JDK)";

    private final Function<TestContext, VerifyResult> verifier;
    private final Supplier<JavaCompiler> compiler;

    /** {@code verifier} — обычно {@code behaviorVerifier::verify} ({@link BehaviorVerifier#verify}). */
    public QualityGate(Function<TestContext, VerifyResult> verifier) {
        this(verifier, ToolProvider::getSystemJavaCompiler);
    }

    /** {@code compiler} возвращает null — компилятора нет (JRE): фикс отклоняется с {@link #NO_COMPILER}. */
    QualityGate(Function<TestContext, VerifyResult> verifier, Supplier<JavaCompiler> compiler) {
        this.verifier = verifier;
        this.compiler = compiler;
    }

    /**
     * @param originalFiles загруженная версия проекта (эталон для IO-тестов {@code mode: original})
     * @param currentFiles  текущая версия, к которой применяется фикс
     */
    public Result apply(Map<String, String> originalFiles, Map<String, String> currentFiles, String mainClass,
                        Refactoring fix, String target) {
        Map<String, String> changed;
        // фикс получает только чтение: правка карты проекта в обход Quality Gate — исключение фикса
        Map<String, String> view = Collections.unmodifiableMap(currentFiles);
        try {
            if (!fix.canApply(view, target)) return Result.rejected("фикс неприменим к " + target, null);
            changed = fix.apply(view, target);
        } catch (RuntimeException e) {
            return Result.rejected("ошибка фикса " + fix.id() + ": " + e.getMessage(), null);
        }
        Map<String, String> patched = new LinkedHashMap<>(currentFiles);
        patched.putAll(changed);

        JavaCompiler jc = compiler.get();
        if (jc == null) return Result.rejected(NO_COMPILER, null);
        List<String> errors = compile(jc, TestContext.javaSources(patched));
        if (!errors.isEmpty()) return Result.rejected("код не компилируется после фикса: " + errors.get(0), null);

        VerifyResult v = verifier.apply(new TestContext(originalFiles, patched, mainClass));
        return switch (v.status()) {
            case BLOCKED -> Result.rejected(String.join("; ", v.warnings()), v);
            case RED -> Result.rejected(failures(v.results()), v);
            case INCOMPLETE -> new Result(true, v.results().isEmpty() ? NO_TESTS_NOTE
                    : INCOMPLETE_NOTE + ": " + String.join("; ", v.warnings()), changed, v);
            case GREEN -> new Result(true, null, changed, v);
        };
    }

    /** «тест merge не проходит после фикса», «тест X не компилируется», через «; ». */
    static String failures(List<TestResult> results) {
        List<String> parts = new ArrayList<>();
        for (TestResult r : results) {
            if (r.passed()) continue;
            parts.add("тест " + r.name() + (r.status() == TestStatus.COMPILE_ERROR ? " не компилируется"
                    : r.status() == TestStatus.ORIGINAL_FAILS ? " не проходит (и на оригинале)" : " не проходит после фикса"));
        }
        return String.join("; ", parts);
    }

    /** Компиляция исходников программы в процессе ({@code -proc:none}: код при компиляции не исполняется). Пусто — ок. */
    static List<String> compile(JavaCompiler jc, Map<String, String> sources) {
        if (sources.isEmpty()) return List.of();
        List<JavaFileObject> units = new ArrayList<>();
        sources.forEach((path, text) -> units.add(new SimpleJavaFileObject(
                URI.create("string:///" + path.replace(' ', '_')), JavaFileObject.Kind.SOURCE) {
            @Override
            public CharSequence getCharContent(boolean ignoreEncodingErrors) {
                return text;
            }
        }));
        DiagnosticCollector<JavaFileObject> diag = new DiagnosticCollector<>();
        Path out = null;
        try (var fm = jc.getStandardFileManager(diag, null, StandardCharsets.UTF_8)) {
            out = Files.createTempDirectory("bp-gate");
            boolean ok = jc.getTask(null, fm, diag, List.of("-proc:none", "-nowarn", "-d", out.toString()),
                    null, units).call();
            if (ok) return List.of();
            List<String> errors = new ArrayList<>();
            for (Diagnostic<? extends JavaFileObject> d : diag.getDiagnostics()) {
                if (d.getKind() != Diagnostic.Kind.ERROR) continue;
                String file = d.getSource() == null ? "" : d.getSource().getName().replaceFirst("^/", "") + ":" + d.getLineNumber() + ": ";
                errors.add(file + d.getMessage(null));
            }
            return errors.isEmpty() ? List.of("ошибка компиляции") : errors;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } finally {
            if (out != null) deleteQuietly(out);
        }
    }

    private static void deleteQuietly(Path dir) {
        try (Stream<Path> s = Files.walk(dir)) {
            s.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
        } catch (IOException ignored) {
            // временная папка; не мешает результату
        }
    }
}
