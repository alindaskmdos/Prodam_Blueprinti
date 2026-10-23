package blueprints.testing;

import java.util.List;

/** Точка расширения: источник тестов (IO, JUnit). Новый источник = новый класс + строка в {@link TestSourceRegistry}. */
public interface TestSource {
    /** Значение поля {@code type} в результатах: {@code io}, {@code junit}. */
    String id();

    /** Прогоняет все свои тесты проекта: текущую версию против оригинала. Результаты — в порядке тестов. */
    List<TestResult> run(TestContext ctx);
}
