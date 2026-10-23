package blueprints.app;

import java.util.Map;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Тестовый эндпоинт: проверяет общий механизм 409 до появления настоящих мутаций (BE-07). */
@RestController
class VersionTestController {
    private final ProjectStore store;

    VersionTestController(ProjectStore store) {
        this.store = store;
    }

    @PostMapping("/api/_test/{id}/touch")
    Map<String, Integer> touch(@PathVariable String id, @RequestParam int version) {
        return Map.of("version", store.update(id, version, c -> c).version());
    }

    /** Непредвиденная ошибка — проверка общего обработчика 500 INTERNAL. */
    @PostMapping("/api/_test/boom")
    Map<String, Integer> boom() {
        throw new IllegalStateException("boom");
    }
}
