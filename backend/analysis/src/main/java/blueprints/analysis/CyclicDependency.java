package blueprints.analysis;

import blueprints.model.Issue;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Циклическая зависимость классов (§14а.4): каждая сильно связная компонента {@link ProjectAnalysis#dependencies()} из 2+ классов.
 * Уровень проекта: без methodId/blockId, classIds — FQN классов цикла, span — объявление первого класса;
 * 2 класса — low, 3+ — medium; confidence high (связи из текста объявлений); фикса нет, только рекомендация.
 */
public final class CyclicDependency implements Detector {
    public static final String RULE = "CyclicDependency";

    @Override
    public String id() {
        return RULE;
    }

    @Override
    public List<Issue> detect(MethodAnalysis method, ProjectAnalysis project) {
        return List.of();
    }

    @Override
    public List<Issue> detectProject(ProjectAnalysis project) {
        DependencyGraph g = project.dependencies();
        UmlModel uml = project.uml();
        return g.cycles().stream().map(c -> {
            String route = g.route(c).stream().map(id -> uml.clazz(id).name()).collect(Collectors.joining(" → "));
            String message = "Циклическая зависимость классов: " + route;
            if (g.route(c).size() - 1 < c.classes().size()) {
                message += " (в цикле " + c.classes().size() + " классов: "
                        + c.classes().stream().map(id -> uml.clazz(id).name()).collect(Collectors.joining(", ")) + ")";
            }
            return new Issue(c.issueId(), RULE, c.severity(), "high", "blueprints", uml.clazz(c.classes().get(0)).span(),
                    null, null, message, "Разорвать цикл: вынести общий интерфейс или передавать данные параметром",
                    null, List.of(), c.classes());
        }).toList();
    }

    /** id Issue цикла: по первому классу (компоненты не пересекаются) — тот же в DependencyGraph.cycles[].issueId. */
    static String issueId(List<String> classes) {
        return RULE + ":" + classes.get(0);
    }
}
