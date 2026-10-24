package blueprints.app;

import blueprints.analysis.DependencyGraph;
import blueprints.analysis.ProjectAnalysis;
import blueprints.analysis.UmlModel;
import blueprints.model.Span;
import blueprints.source.LoadedProject;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Диаграммы проекта (§14а): UML-модель классов и граф зависимостей с циклами. Строятся по текущей версии на каждый запрос, без кэша. */
@RestController
@RequestMapping("/api/projects")
class DiagramController {
    /** UmlClass контракта; typeParams null — ключа нет. */
    record UmlClassDto(String id, String name, String kind, @JsonProperty("package") String pkg, String path, Span span,
                       List<String> modifiers, String typeParams, List<UmlModel.Field> fields,
                       List<UmlModel.Member> constructors, List<UmlModel.Member> methods) {}

    record UmlDto(int version, List<UmlClassDto> classes, List<UmlModel.Relation> relations) {}

    /** DependencyGraph контракта: kind у узлов заполняется всегда. */
    record NodeDto(String id, String name, String kind, @JsonProperty("package") String pkg, String path) {}

    record DependenciesDto(int version, List<NodeDto> nodes, List<DependencyGraph.Edge> edges, List<DependencyGraph.Cycle> cycles) {}

    private final ProjectStore store;

    DiagramController(ProjectStore store) {
        this.store = store;
    }

    @GetMapping("/{id}/uml")
    UmlDto uml(@PathVariable String id) {
        var s = store.get(id);
        return uml(s.content(), s.version());
    }

    static UmlDto uml(LoadedProject project, int version) {
        UmlModel m = ProjectAnalysis.of(project.files()).uml();
        List<UmlClassDto> classes = m.classes().stream().map(c -> new UmlClassDto(c.id(), c.name(), c.kind(), c.pkg(), c.path(),
                c.span(), c.modifiers(), c.typeParams(), c.fields(), c.constructors(), c.methods())).toList();
        return new UmlDto(version, classes, m.relations());
    }

    /** cycles[].issueId — id Issue CyclicDependency в GET analysis той же версии. */
    @GetMapping("/{id}/dependencies")
    DependenciesDto dependencies(@PathVariable String id) {
        var s = store.get(id);
        return dependencies(s.content(), s.version());
    }

    static DependenciesDto dependencies(LoadedProject project, int version) {
        DependencyGraph g = ProjectAnalysis.of(project.files()).dependencies();
        List<NodeDto> nodes = g.nodes().stream().map(n -> new NodeDto(n.id(), n.name(), n.kind(), n.pkg(), n.path())).toList();
        return new DependenciesDto(version, nodes, g.edges(), g.cycles());
    }
}
