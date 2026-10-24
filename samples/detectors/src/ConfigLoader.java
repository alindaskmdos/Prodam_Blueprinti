import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Загрузка настроек сервиса из пар key=value. Правило: EmptyCatch. */
public class ConfigLoader {
    private final Map<String, String> raw = new LinkedHashMap<>();
    private int port = 8080;
    private int retries = 3;
    private final List<Integer> workerPorts = new ArrayList<>();

    public ConfigLoader(List<String> lines) {
        for (String line : lines) {
            int eq = line.indexOf('=');
            if (eq > 0) {
                raw.put(line.substring(0, eq), line.substring(eq + 1));
            }
        }
    }

    /** Опечатка в порту молча оставляет 8080 — сервис поднимется не там, где ждут. */
    public int port() {
        // ожидается: EmptyCatch (пустое тело, confidence high)
        try {
            port = Integer.parseInt(raw.getOrDefault("port", "8080"));
        } catch (NumberFormatException e) {
        }
        return port;
    }

    /** Только комментарий в catch — возможно, намеренно, но ошибка всё равно теряется. */
    public int retries() {
        // ожидается: EmptyCatch (только комментарий, confidence low)
        try {
            retries = Integer.parseInt(raw.getOrDefault("retries", "3"));
        } catch (NumberFormatException e) {
            // по умолчанию 3, пусть будет
        }
        return retries;
    }

    /** Пустой catch внутри лямбды тоже находка: битый порт воркера просто пропадает из списка. */
    public List<Integer> workerPorts() {
        workerPorts.clear();
        List<String> items = List.of(raw.getOrDefault("workers", "").split(","));
        items.forEach(item -> {
            // ожидается: EmptyCatch (в лямбде, confidence high)
            try {
                workerPorts.add(Integer.parseInt(item.strip()));
            } catch (NumberFormatException e) {
            }
        });
        return workerPorts;
    }

    /** не находка: catch логирует проблему и подставляет значение по умолчанию. */
    public int timeoutSeconds() {
        String value = raw.getOrDefault("timeout", "30");
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            System.out.println("WARN bad timeout '" + value + "', using 30");
            return 30;
        }
    }

    /** не находка: catch пробрасывает исключение-обёртку с причиной. */
    public int maxConnections() {
        String value = raw.getOrDefault("maxConnections", "100");
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            throw new IllegalStateException("maxConnections must be a number: " + value, e);
        }
    }

    public static void demo() {
        ConfigLoader config = new ConfigLoader(List.of(
                "port=80O", "retries=five", "workers=9001, 9002,90x3", "timeout=1m", "maxConnections=250"));
        System.out.println("port=" + config.port());
        System.out.println("retries=" + config.retries());
        System.out.println("workers=" + config.workerPorts());
        System.out.println("timeout=" + config.timeoutSeconds());
        System.out.println("maxConnections=" + config.maxConnections());
        ConfigLoader broken = new ConfigLoader(List.of("maxConnections=lots"));
        try {
            broken.maxConnections();
        } catch (IllegalStateException e) {
            System.out.println("ERROR " + e.getMessage());
        }
    }
}
