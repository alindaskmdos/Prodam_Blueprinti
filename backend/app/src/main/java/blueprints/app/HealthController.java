package blueprints.app;

import java.util.concurrent.TimeUnit;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class HealthController {
    record HealthDto(String status, boolean docker, boolean llm) {}

    private static final long CACHE_MS = 5_000;
    private long checkedAt;
    private Boolean docker;

    @GetMapping("/api/health")
    HealthDto health() {
        String key = System.getenv("LLM_API_KEY");
        return new HealthDto("UP", docker(), key != null && !key.isBlank());
    }

    /** Тот же docker CLI, что у Runner; демон недоступен или не ответил за 2 с — false. Кэш на 5 с. */
    synchronized boolean docker() {
        long now = System.currentTimeMillis();
        if (docker == null || now - checkedAt > CACHE_MS) {
            docker = dockerUp("docker");
            checkedAt = now;
        }
        return docker;
    }

    static boolean dockerUp(String exe) {
        try {
            Process p = new ProcessBuilder(exe, "version", "--format", "{{.Server.Version}}").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            if (p.waitFor(2, TimeUnit.SECONDS)) return p.exitValue() == 0;
            p.destroyForcibly();
            return false;
        } catch (Exception e) {
            return false;
        }
    }
}
