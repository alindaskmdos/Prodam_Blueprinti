package blueprints.testing;

import blueprints.runner.Runner;
import java.util.List;

/** Точка расширения: источник тестов (IO, JUnit). Новый источник = новый класс + строка в {@link TestSourceRegistry}. */
public interface TestSource {
    /** Значение поля {@code type} в результатах: {@code io}, {@code junit}. */
    String id();

    /** Прогоняет все свои тесты проекта: текущую версию против оригинала. Результаты — в порядке тестов. */
    List<TestResult> run(TestContext ctx);

    /**
     * Разбор результатов своей части общего пакета.
     * {@code batchResults} — результаты <b>всех</b> запусков пакета, по индексам {@link Batch#addJob}.
     */
    @FunctionalInterface
    interface Prepared {
        List<TestResult> results(List<Runner.RunResult> batchResults);
    }

    /**
     * Проверка поведения ({@link BehaviorVerifier}): добавляет свои запуски в общий пакет (один контейнер на весь
     * прогон) и возвращает разбор результатов. По умолчанию источник контейнер не делит — прогоняется отдельно
     * через {@link #run} во время разбора. Источники, запускающие код, переопределяют.
     */
    default Prepared prepare(TestContext ctx, Batch batch) {
        return batchResults -> run(ctx);
    }

    /** Есть ли тесты, подающие программе непустой вход (stdin) — для блокировки §10.5. */
    default boolean providesInput(TestContext ctx) {
        return false;
    }
}
