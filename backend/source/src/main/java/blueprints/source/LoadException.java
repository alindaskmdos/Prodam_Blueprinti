package blueprints.source;

import java.util.List;

/** Отказ при загрузке; code — значение enum Error.code из контракта. */
public final class LoadException extends RuntimeException {
    private final String code;
    private final List<String> files;

    public LoadException(String code, String message) {
        this(code, message, null);
    }

    /** files — конфликтующие файлы (DUPLICATE_FQN), иначе null. */
    public LoadException(String code, String message, List<String> files) {
        super(message);
        this.code = code;
        this.files = files;
    }

    public String code() {
        return code;
    }

    public List<String> files() {
        return files;
    }
}
