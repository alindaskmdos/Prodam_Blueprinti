package blueprints.testing;

import java.util.List;

/**
 * Результат проверки поведения в форме контрактного {@code VerifyResult} (поля и имена совпадают).
 * Временный тип модуля testing: после BE-05 заменяется record'ом из model одним адаптером.
 */
public record VerifyResult(Status status, List<TestResult> results, List<String> warnings) {

    /** Контрактный {@code VerifyResult.status}. {@link #wire()} — значение в JSON. */
    public enum Status {
        /** Поведение совпадает: все тесты всех источников зелёные. */
        GREEN("green"),
        /** Хоть один тест не зелёный. */
        RED("red"),
        /** Ничего не упало, но проверка неполная (>50% шумных строк, тестов нет). */
        INCOMPLETE("incomplete"),
        /** Программа читает stdin, а IO-тестов со входом нет; тесты не запускались. */
        BLOCKED("blocked");

        private final String wire;

        Status(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }
    }

    public VerifyResult {
        results = List.copyOf(results);
        warnings = List.copyOf(warnings);
    }
}
