package blueprints.app;

import blueprints.fixes.QualityGate;
import blueprints.fixes.Refactoring;
import blueprints.fixes.RefactoringRegistry;
import blueprints.model.Issue;
import blueprints.runner.Runner;
import blueprints.source.LoadedProject;
import blueprints.source.SourceFile;
import blueprints.testing.BehaviorVerifier;
import blueprints.testing.TestContext;
import blueprints.testing.TestSourceRegistry;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** POST fix (§9, §12): фикс из {@link RefactoringRegistry} через {@link QualityGate}; применён — version+1, отклонён — без изменений. */
@RestController
@RequestMapping("/api/projects/{id}")
class FixController {
    record FixRequest(Integer version, String fixId) {}

    record FixDto(boolean applied, String reason, int version, String diff, ProjectView.Mutation mutation,
                  RunController.VerifyDto verify) {}

    private final ProjectStore store;
    private final QualityGate gate;

    FixController(ProjectStore store) {
        this.store = store;
        Runner runner = new Runner(Runner.Config.defaults());
        this.gate = new QualityGate(new BehaviorVerifier(TestSourceRegistry.defaults(runner), runner)::verify);
    }

    @PostMapping("/issues/{issueId}/fix")
    FixDto fix(@PathVariable String id, @PathVariable String issueId, @RequestBody FixRequest req) {
        if (req.version() == null || req.fixId() == null) throw new ApiException(400, "INVALID_REQUEST", "нужны version и fixId");
        var s = store.get(id);
        // id проблемы действителен только для своей версии; повторная сверка — в update после Quality Gate
        if (s.version() != req.version()) throw ProjectStore.conflict(req.version(), s.version());
        Issue issue = new ProjectView(s.content()).analysis(s.version()).issues().stream()
                .filter(i -> i.id().equals(issueId)).findFirst()
                .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "проблема не найдена: " + issueId));
        Refactoring fix = RefactoringRegistry.defaults().byId(req.fixId());
        if (fix == null || !issue.fixes().contains(req.fixId())) {
            throw new ApiException(404, "NOT_FOUND", "фикс " + req.fixId() + " не предлагается для " + issueId);
        }
        Map<String, String> current = RunController.texts(s.content());
        TestContext ctx = new TestContext(RunController.texts(s.original()), current, null);
        // у fix в контракте нет 422/503: несколько main / нет песочницы — Quality Gate не подтвердил, откат
        QualityGate.Result gated;
        try {
            RunController.checkMains(ctx);
            gated = RunController.sandbox(() -> gate.apply(ctx.originalFiles(), current, null, fix, issueId));
        } catch (ApiException e) {
            return new FixDto(false, QualityGate.NOT_CONFIRMED + ": " + e.getMessage(), s.version(), null, null, null);
        }
        QualityGate.Result r = gated;
        RunController.VerifyDto verify = r.verify() == null ? null : RunController.dto(r.verify());
        if (!r.applied()) return new FixDto(false, r.reason(), s.version(), null, null, verify);

        var saved = store.update(id, req.version(), p -> withFiles(p, r.changed()));
        StringBuilder diff = new StringBuilder();
        r.changed().forEach((path, text) -> diff.append(Diff.unified(path, current.get(path), text)));
        ProjectView view = new ProjectView(saved.content());
        String first = r.changed().keySet().iterator().next();
        var mutation = new ProjectView.Mutation(saved.version(), r.changed().get(first), null, view.tree(saved.version()),
                view.analysis(saved.version()));
        return new FixDto(true, r.reason(), saved.version(), diff.toString(), mutation, verify);
    }

    /** Новые тексты существующих файлов (исходники и tests/). Пакет не пересчитывается: фиксы его не меняют. */
    static LoadedProject withFiles(LoadedProject p, Map<String, String> changed) {
        List<SourceFile> files = new ArrayList<>(p.files());
        Map<String, byte[]> tests = new LinkedHashMap<>(p.testFiles());
        changed.forEach((path, text) -> {
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            int i = files.stream().map(SourceFile::path).toList().indexOf(path);
            if (i >= 0) files.set(i, new SourceFile(path, files.get(i).pkg(), bytes));
            else if (tests.containsKey(path)) tests.put(path, bytes);
            else throw new IllegalStateException("фикс создал новый файл, это не поддерживается: " + path);
        });
        return new LoadedProject(p.root(), files, p.warnings(), tests, p.mainClasses());
    }
}
