package blueprints.testing;

import java.util.List;

/**
 * Результат одного теста в форме контрактного {@code TestResult} (поля и имена совпадают).
 * Временный тип модуля testing: после BE-05 заменяется record'ом из model одним адаптером.
 *
 * @param type       {@code io} | {@code junit}
 * @param error      текст ошибки; у {@code passed} — null или пояснение, не ошибка (например, «оригинал не проходит
 *                   этот тест — правка его исправила», «оригинал не компилируется»)
 * @param expected   эталонный stdout (для diff), может быть null
 * @param actual     фактический stdout текущей версии, может быть null
 * @param noisyLines строки вывода с 1, различающиеся между прогонами оригинала (заполняет BE-10)
 */
public record TestResult(String name, String type, TestStatus status, long durationMs, String error,
                         String expected, String actual, List<Integer> noisyLines) {
    public TestResult {
        noisyLines = noisyLines == null ? List.of() : List.copyOf(noisyLines);
    }

    public boolean passed() {
        return status == TestStatus.PASSED;
    }
}
