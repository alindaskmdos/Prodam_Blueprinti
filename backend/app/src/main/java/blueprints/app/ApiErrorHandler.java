package blueprints.app;

import blueprints.blocks.InvalidNodeException;
import blueprints.source.LoadException;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

/** Любая ошибка API отдаётся телом Error контракта. */
@RestControllerAdvice
class ApiErrorHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiErrorHandler.class);

    /** Тело ошибки по схеме Error контракта; null-поля не сериализуются. */
    record ErrorBody(String code, String message, String blockId, Integer line, List<String> files, Map<String, Object> details) {
        ErrorBody(String code, String message) {
            this(code, message, null, null, null, null);
        }
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ErrorBody> api(ApiException e) {
        return ResponseEntity.status(e.status())
                .body(new ErrorBody(e.code(), e.getMessage(), e.blockId(), e.line(), null, e.details()));
    }

    /** Текст ноды не прошёл проверку (в т.ч. комментарий с \\u-escape) — 422 PARSE_ERROR с blockId, как в контракте PUT blocks. */
    @ExceptionHandler(InvalidNodeException.class)
    ResponseEntity<ErrorBody> invalidNode(InvalidNodeException e) {
        return ResponseEntity.status(422).body(new ErrorBody("PARSE_ERROR", e.getMessage(), e.blockId(), null, null, null));
    }

    @ExceptionHandler(LoadException.class)
    ResponseEntity<ErrorBody> load(LoadException e) {
        int status = switch (e.code()) {
            case "LIMIT_EXCEEDED" -> 413;
            case "INVALID_REQUEST" -> 400;
            default -> 422; // ZIP_SLIP, NO_SOURCES, DUPLICATE_FQN, PARSE_ERROR
        };
        return ResponseEntity.status(status).body(new ErrorBody(e.code(), e.getMessage(), null, null, e.files(), null));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ErrorBody> tooBig(MaxUploadSizeExceededException e) {
        return ResponseEntity.status(413).body(new ErrorBody("LIMIT_EXCEEDED", "превышен допустимый размер загрузки"));
    }

    /** Неверные параметры, битый JSON тела, битый multipart. */
    @ExceptionHandler({MissingServletRequestPartException.class, MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class, HttpMessageNotReadableException.class, MultipartException.class})
    ResponseEntity<ErrorBody> bad(Exception e) {
        return ResponseEntity.status(400).body(new ErrorBody("INVALID_REQUEST", e.getMessage()));
    }

    /** Всё остальное: исключения Spring со своим статусом (404 нет ресурса, 405 …) и 500 INTERNAL. */
    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorBody> other(Exception e) {
        if (e instanceof ErrorResponse er && er.getStatusCode().value() < 500) {
            int s = er.getStatusCode().value();
            return ResponseEntity.status(s).body(new ErrorBody(s == 404 ? "NOT_FOUND" : "INVALID_REQUEST", e.getMessage()));
        }
        log.error("Необработанная ошибка", e);
        return ResponseEntity.status(500).body(new ErrorBody("INTERNAL", "внутренняя ошибка: " + e.getClass().getSimpleName()));
    }
}
