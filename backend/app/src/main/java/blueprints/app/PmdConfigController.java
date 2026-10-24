package blueprints.app;

import blueprints.analysis.PmdDetector;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Конфиг PMD проекта (§14а.2): {@code .blueprints/pmd-ruleset.xml} хранится в {@link ProjectStore.Stored#pmdRuleset()}
 * (null — стандартный набор {@link PmdDetector#DEFAULT_RULESET}). PUT/DELETE — version+1 и анализ с новым конфигом.
 */
@RestController
@RequestMapping("/api/projects/{id}/pmd-config")
class PmdConfigController {
    /** Путь конфига в проекте: экспорт zip (includeSettings) и импорт при загрузке. */
    static final String PATH = ".blueprints/pmd-ruleset.xml";

    record PmdConfigDto(int version, String xml, boolean isDefault) {}

    record PutRequest(Integer version, String xml) {}

    record MutationDto(int version, boolean isDefault, ProjectView.AnalysisDto analysis) {}

    private final ProjectStore store;

    PmdConfigController(ProjectStore store) {
        this.store = store;
    }

    @GetMapping
    PmdConfigDto get(@PathVariable String id) {
        var s = store.get(id);
        return new PmdConfigDto(s.version(), s.pmdRuleset() == null ? PmdDetector.DEFAULT_RULESET : s.pmdRuleset(), s.pmdRuleset() == null);
    }

    /** Битый XML / не ruleset / неизвестное правило -> 422 INVALID_RULESET, конфиг и версия прежние. */
    @PutMapping
    MutationDto put(@PathVariable String id, @RequestBody PutRequest req) {
        if (req.version() == null || req.xml() == null) throw new ApiException(400, "INVALID_REQUEST", "нужны version и xml");
        store.get(id); // неизвестный проект — 404, а не 422
        try {
            PmdDetector.validate(req.xml());
        } catch (PmdDetector.InvalidRulesetException e) {
            throw ApiException.invalidRuleset(e.getMessage(), e.line());
        }
        return result(store.setPmdRuleset(id, req.version(), req.xml()));
    }

    @DeleteMapping
    MutationDto reset(@PathVariable String id, @RequestParam int version) {
        return result(store.setPmdRuleset(id, version, null));
    }

    private static MutationDto result(ProjectStore.Stored s) {
        return new MutationDto(s.version(), s.pmdRuleset() == null, new ProjectView(s).analysis(s.version()));
    }
}
