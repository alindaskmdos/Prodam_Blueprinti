package blueprints.app;

import blueprints.source.LoadedProject;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.UnaryOperator;
import org.springframework.stereotype.Component;

/** Проекты в памяти. Любая мутация — через {@link #update}: сверка версии (409) и инкремент атомарно. */
@Component
public class ProjectStore {
    public record Stored(String id, int version, LoadedProject content) {}

    private final Map<String, Stored> projects = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger();

    public Stored create(LoadedProject content) {
        Stored s = new Stored("p-" + seq.incrementAndGet(), 1, content);
        projects.put(s.id(), s);
        return s;
    }

    public Stored get(String id) {
        Stored s = projects.get(id);
        if (s == null) throw new ApiException(404, "NOT_FOUND", "проект не найден: " + id);
        return s;
    }

    /**
     * Применяет изменение, если clientVersion == текущей; иначе ApiException 409 VERSION_CONFLICT
     * (details clientVersion/serverVersion). Возвращает проект с версией +1.
     */
    public Stored update(String id, int clientVersion, UnaryOperator<LoadedProject> change) {
        return projects.compute(id, (k, cur) -> {
            if (cur == null) throw new ApiException(404, "NOT_FOUND", "проект не найден: " + id);
            if (cur.version() != clientVersion) {
                throw new ApiException(409, "VERSION_CONFLICT",
                        "Версия проекта устарела: клиент " + clientVersion + ", сервер " + cur.version(),
                        Map.of("clientVersion", clientVersion, "serverVersion", cur.version()));
            }
            return new Stored(id, cur.version() + 1, change.apply(cur.content()));
        });
    }
}
