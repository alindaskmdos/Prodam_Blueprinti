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
    /**
     * original — проект как загружен: эталон оригинала для POST /verify (§10.1).
     * pmdRuleset — текст {@code .blueprints/pmd-ruleset.xml} (прошёл {@code PmdDetector.validate}) или null — стандартный набор.
     */
    public record Stored(String id, int version, LoadedProject content, LoadedProject original, String pmdRuleset) {}

    private final Map<String, Stored> projects = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger();

    public Stored create(LoadedProject content) {
        return create(content, null);
    }

    public Stored create(LoadedProject content, String pmdRuleset) {
        Stored s = new Stored("p-" + seq.incrementAndGet(), 1, content, content, pmdRuleset);
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
            if (cur.version() != clientVersion) throw conflict(clientVersion, cur.version());
            return new Stored(id, cur.version() + 1, change.apply(cur.content()), cur.original(), cur.pmdRuleset());
        });
    }

    /** Новый ruleset PMD (null — стандартный набор): сверка версии как в {@link #update}, version+1, код не меняется. */
    public Stored setPmdRuleset(String id, int clientVersion, String pmdRuleset) {
        return projects.compute(id, (k, cur) -> {
            if (cur == null) throw new ApiException(404, "NOT_FOUND", "проект не найден: " + id);
            if (cur.version() != clientVersion) throw conflict(clientVersion, cur.version());
            return new Stored(id, cur.version() + 1, cur.content(), cur.original(), pmdRuleset);
        });
    }

    /** 409 VERSION_CONFLICT с details clientVersion/serverVersion. */
    public static ApiException conflict(int clientVersion, int serverVersion) {
        return new ApiException(409, "VERSION_CONFLICT",
                "Версия проекта устарела: клиент " + clientVersion + ", сервер " + serverVersion,
                Map.of("clientVersion", clientVersion, "serverVersion", serverVersion));
    }
}
