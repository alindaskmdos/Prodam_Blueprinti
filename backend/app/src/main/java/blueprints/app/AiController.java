package blueprints.app;

import blueprints.ai.Ai;
import blueprints.ai.LlmClient;
import blueprints.ai.MethodPatch;
import blueprints.ai.OpenAiClient;
import blueprints.ai.RateLimiter;
import blueprints.blocks.AstToBlocks;
import blueprints.blocks.MethodLocator;
import blueprints.model.Block;
import blueprints.model.Issue;
import blueprints.source.SourceFile;
import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.body.CallableDeclaration;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * ИИ (§14а.10, CT-04): capabilities, explain, ai-edit (только предложение), ai-fix (через Quality Gate FixController).
 * Порядок проверок: нет ИИ → 503; версия/проект/метод → 400/404/409; лимит → 429; сбой провайдера → 503.
 */
@RestController
@RequestMapping("/api")
class AiController {
    record VersionRequest(Integer version) {}

    record EditRequest(Integer version, String blockId, String instruction) {}

    record Limits(int perMinute, int perDay) {}

    record CapabilitiesDto(boolean llm, List<String> features, Limits limits) {}

    record ExplanationDto(int version, String text) {}

    record EditProposalDto(int version, String path, String text, String diff) {}

    private record Located(String path, String text, CallableDeclaration<?> decl) {}

    /** Бины ИИ из env; тесты подменяют своими (@Primary). */
    @Configuration
    static class Beans {
        @Bean
        Ai ai() {
            LlmConfig c = LlmConfig.fromEnv();
            return new Ai(c.enabled() ? new OpenAiClient(c.apiKey(), c.baseUrl(), c.model()) : null);
        }

        @Bean
        RateLimiter aiRateLimiter() {
            return RateLimiter.fromEnv(System.getenv());
        }
    }

    private final ProjectStore store;
    private final Ai ai;
    private final RateLimiter limiter;
    private final FixController fixes;

    AiController(ProjectStore store, Ai ai, RateLimiter limiter, FixController fixes) {
        this.store = store;
        this.ai = ai;
        this.limiter = limiter;
        this.fixes = fixes;
    }

    @GetMapping("/capabilities")
    CapabilitiesDto capabilities() {
        return new CapabilitiesDto(ai.available(), ai.available() ? Ai.FEATURES : List.of(),
                new Limits(limiter.perMinute(), limiter.perDay()));
    }

    @PostMapping("/projects/{id}/methods/{methodId}/explain")
    ExplanationDto explain(@PathVariable String id, @PathVariable String methodId, @RequestBody VersionRequest req,
                           HttpServletRequest http) {
        var s = current(id, req.version());
        Located m = locate(s, methodId);
        limit(http);
        return new ExplanationDto(s.version(), call(() -> ai.explain(m.text(), m.decl())));
    }

    @PostMapping("/projects/{id}/methods/{methodId}/ai-edit")
    EditProposalDto edit(@PathVariable String id, @PathVariable String methodId, @RequestBody EditRequest req,
                         HttpServletRequest http) {
        var s = current(id, req.version());
        if (req.blockId() == null || req.instruction() == null || req.instruction().isBlank()) {
            throw new ApiException(400, "INVALID_REQUEST", "нужны version, blockId и instruction");
        }
        Located m = locate(s, methodId);
        String fragment = null;
        if (!req.blockId().equals(methodId)) {
            Block b = find(AstToBlocks.convert(m.decl(), methodId, m.path()), req.blockId());
            if (b == null || b.span() == null) throw new ApiException(404, "NOT_FOUND", "нода не найдена: " + req.blockId());
            List<String> lines = m.text().lines().toList();
            fragment = String.join("\n", lines.subList(b.span().startLine() - 1, b.span().endLine())).stripIndent();
        }
        limit(http);
        String f = fragment;
        String text = call(() -> ai.edit(m.text(), m.decl(), f, req.instruction()));
        return new EditProposalDto(s.version(), m.path(), text, Diff.unified(m.path(), m.text(), text));
    }

    @PostMapping("/projects/{id}/issues/{issueId}/ai-fix")
    FixController.FixDto fix(@PathVariable String id, @PathVariable String issueId, @RequestBody VersionRequest req,
                             HttpServletRequest http) {
        var s = current(id, req.version());
        Issue issue = new ProjectView(s).analysis(s.version()).issues().stream()
                .filter(i -> i.id().equals(issueId)).findFirst()
                .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "проблема не найдена: " + issueId));
        if (issue.methodId() == null) throw new ApiException(404, "NOT_FOUND", "ИИ-фикс — только для проблем метода: " + issueId);
        Located m = locate(s, issue.methodId());
        limit(http);
        var fix = call(() -> ai.proposeFix(issue, m.path(), m.text(), m.decl()));
        return fixes.gate(s, issueId, fix);
    }

    /** Сессия для лимита в минуту: X-Session-Id, иначе первый X-Forwarded-For (за nginx), иначе адрес клиента. */
    static String session(HttpServletRequest r) {
        String h = r.getHeader("X-Session-Id");
        if (h != null && !h.isBlank()) return "s:" + h.strip().substring(0, Math.min(128, h.strip().length()));
        String fwd = r.getHeader("X-Forwarded-For");
        if (fwd != null && !fwd.isBlank()) return "ip:" + fwd.split(",")[0].strip();
        return "ip:" + r.getRemoteAddr();
    }

    private ProjectStore.Stored current(String id, Integer version) {
        if (!ai.available()) throw new ApiException(503, "LLM_UNAVAILABLE", "ИИ не настроен: не задан LLM_API_KEY");
        if (version == null) throw new ApiException(400, "INVALID_REQUEST", "нужна version");
        var s = store.get(id);
        if (s.version() != version) throw ProjectStore.conflict(version, s.version());
        return s;
    }

    private void limit(HttpServletRequest http) {
        try {
            limiter.acquire(session(http));
        } catch (RateLimiter.Limited e) {
            throw new ApiException(429, "RATE_LIMITED", e.getMessage(), Map.of("retryAfterSec", e.retryAfterSec()));
        }
    }

    private static <T> T call(Supplier<T> f) {
        try {
            return f.get();
        } catch (LlmClient.Unavailable e) {
            throw new ApiException(503, "LLM_UNAVAILABLE", e.getMessage());
        } catch (MethodPatch.BadReply e) {
            throw ApiException.parseError(e.getMessage(), null, null);
        }
    }

    private static Located locate(ProjectStore.Stored s, String methodId) {
        JavaParser parser = new JavaParser(new ParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21));
        for (SourceFile f : s.content().files()) {
            var cu = parser.parse(f.text()).getResult();
            var decl = cu.flatMap(c -> MethodLocator.find(c, methodId));
            if (decl.isPresent()) return new Located(f.path(), f.text(), decl.get());
        }
        throw new ApiException(404, "NOT_FOUND", "метод не найден: " + methodId);
    }

    private static Block find(Block b, String id) {
        if (b.id().equals(id)) return b;
        for (List<Block> slot : b.slots().values()) {
            for (Block c : slot) {
                Block r = find(c, id);
                if (r != null) return r;
            }
        }
        return null;
    }
}
