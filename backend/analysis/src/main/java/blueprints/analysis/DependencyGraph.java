package blueprints.analysis;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Граф зависимостей классов проекта (§14а.4): «класс → классы проекта, которые он использует» — связи UML любого вида,
 * без связей внешний ↔ вложенный и без петель. Циклы — сильно связные компоненты из 2+ классов (Тарьян из {@link CallGraph}).
 */
public final class DependencyGraph {
    public record Node(String id, String name, String kind, String pkg, String path) {}

    public record Edge(String from, String to, boolean inCycle) {}

    /** classes — в порядке узлов графа; severity: 2 класса — low, 3+ — medium; issueId — id Issue CyclicDependency. */
    public record Cycle(List<String> classes, String severity, String issueId) {}

    private final List<Node> nodes;
    private final List<Edge> edges;
    private final List<Cycle> cycles;
    private final Map<String, Set<String>> out;

    private DependencyGraph(List<Node> nodes, List<Edge> edges, List<Cycle> cycles, Map<String, Set<String>> out) {
        this.nodes = List.copyOf(nodes);
        this.edges = List.copyOf(edges);
        this.cycles = List.copyOf(cycles);
        this.out = out;
    }

    public List<Node> nodes() {
        return nodes;
    }

    public List<Edge> edges() {
        return edges;
    }

    public List<Cycle> cycles() {
        return cycles;
    }

    static DependencyGraph of(UmlModel uml) {
        List<Node> nodes = new ArrayList<>();
        Map<String, Integer> order = new LinkedHashMap<>();
        Map<String, Set<String>> out = new LinkedHashMap<>();
        for (UmlModel.Clazz c : uml.classes()) {
            order.put(c.id(), nodes.size());
            nodes.add(new Node(c.id(), c.name(), c.kind(), c.pkg(), c.path()));
            out.put(c.id(), new LinkedHashSet<>());
        }
        for (UmlModel.Relation r : uml.relations()) {
            if (!r.from().equals(r.to()) && !uml.nested(r.from(), r.to())) out.get(r.from()).add(r.to());
        }
        List<Set<String>> sccs = new ArrayList<>(new CallGraph(out).cycles());
        List<Cycle> cycles = new ArrayList<>();
        Map<String, Integer> cycleOf = new LinkedHashMap<>();
        sccs.stream().filter(s -> s.size() > 1)
                .map(s -> s.stream().sorted(Comparator.comparing(order::get)).toList())
                .sorted(Comparator.comparing(l -> order.get(l.get(0))))
                .forEach(cls -> {
                    cls.forEach(c -> cycleOf.put(c, cycles.size()));
                    cycles.add(new Cycle(cls, cls.size() == 2 ? "low" : "medium", CyclicDependency.issueId(cls)));
                });
        List<Edge> edges = new ArrayList<>();
        out.forEach((from, tos) -> tos.forEach(to -> edges.add(new Edge(from, to,
                cycleOf.containsKey(from) && cycleOf.get(from).equals(cycleOf.get(to))))));
        return new DependencyGraph(nodes, edges, cycles, out);
    }

    /** Кратчайший замкнутый путь от первого класса цикла обратно к нему внутри компоненты: [A, B, …, A]. */
    List<String> route(Cycle c) {
        String start = c.classes().get(0);
        Set<String> scc = Set.copyOf(c.classes());
        Map<String, String> prev = new LinkedHashMap<>();
        Deque<String> queue = new ArrayDeque<>(List.of(start));
        while (!queue.isEmpty()) {
            String v = queue.poll();
            for (String w : out.get(v)) {
                if (!scc.contains(w)) continue;
                if (w.equals(start)) {
                    List<String> path = new ArrayList<>(List.of(start));
                    for (String x = v; !x.equals(start); x = prev.get(x)) path.add(1, x);
                    path.add(start);
                    return path;
                }
                if (!prev.containsKey(w)) {
                    prev.put(w, v);
                    queue.add(w);
                }
            }
        }
        return List.of(start, start); // недостижимо для компоненты из 2+ классов
    }
}
