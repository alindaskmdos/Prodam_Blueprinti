package blueprints.testing.io;

import java.util.List;

/**
 * IO-тест (§10.1) в форме контрактного {@code TestCase} с {@code type: io}.
 * Временный тип модуля testing: после BE-05 заменяется record'ом из model одним адаптером.
 *
 * @param stdin       вход программы, не null
 * @param expected    ожидаемый stdout; обязателен для {@link Mode#MANUAL}, для ORIGINAL не используется
 * @param ignoreLines номера строк вывода с 1, которые не сравниваются
 */
public record IoTestCase(String name, String stdin, Mode mode, String expected, List<Integer> ignoreLines) {

    public static final String TYPE = "io";

    public enum Mode {
        /** Эталон — запуск исходной программы. */
        ORIGINAL("original"),
        /** Эталон — {@code expected}, заданный пользователем. */
        MANUAL("manual");

        private final String wire;

        Mode(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static Mode fromWire(String s) {
            for (Mode m : values()) if (m.wire.equals(s)) return m;
            throw new IllegalArgumentException(s);
        }
    }

    public IoTestCase {
        ignoreLines = ignoreLines == null ? List.of() : List.copyOf(ignoreLines);
    }

    public String type() {
        return TYPE;
    }
}
