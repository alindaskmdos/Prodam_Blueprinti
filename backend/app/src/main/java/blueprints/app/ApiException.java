package blueprints.app;

import java.util.Map;

/** Ошибка API: HTTP-статус + Error.code контракта (+ details). Превращается в тело Error в {@link ApiErrorHandler}. */
public class ApiException extends RuntimeException {
    private final int status;
    private final String code;
    private final Map<String, Object> details;

    public ApiException(int status, String code, String message, Map<String, Object> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }

    public ApiException(int status, String code, String message) {
        this(status, code, message, null);
    }

    public int status() {
        return status;
    }

    public String code() {
        return code;
    }

    public Map<String, Object> details() {
        return details;
    }
}
