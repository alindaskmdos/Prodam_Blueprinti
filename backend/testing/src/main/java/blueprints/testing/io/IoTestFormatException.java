package blueprints.testing.io;

/** Некорректный IO-тест: сообщение пригодно для показа пользователю (и для ответа 422). */
public class IoTestFormatException extends RuntimeException {
    public IoTestFormatException(String message) {
        super(message);
    }
}
