package blueprints.app;

import java.util.Map;

/** Ошибка API: HTTP-статус + Error.code контракта (+ details). Превращается в тело Error в {@link ApiErrorHandler}. */
public class ApiException extends RuntimeException {
    private final int status;
    private final String code;
    private final Map<String, Object> details;
    private final String blockId;
    private final Integer line;

    public ApiException(int status, String code, String message, Map<String, Object> details) {
        this(status, code, message, details, null, null);
    }

    private ApiException(int status, String code, String message, Map<String, Object> details, String blockId, Integer line) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
        this.blockId = blockId;
        this.line = line;
    }

    /** 422 PARSE_ERROR: blockId — нода (PUT blocks), line — строка файла с 1 (PUT files); лишнее — null. */
    public static ApiException parseError(String message, String blockId, Integer line) {
        return new ApiException(422, "PARSE_ERROR", message, null, blockId, line);
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

    public String blockId() {
        return blockId;
    }

    public Integer line() {
        return line;
    }
}
