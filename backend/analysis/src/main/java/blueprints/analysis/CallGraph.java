package blueprints.analysis;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Граф вызовов методов проекта. Узлы — methodId вида {@code FQN.имя~N} / {@code FQN.<init>~N}, как в дереве проекта.
 * Рекурсия — компоненты сильной связности (Тарьян) размером > 1 или петля.
 */
public final class CallGraph {
    private final Map<String, Set<String>> out = new LinkedHashMap<>();
    private final Map<String, Set<String>> in = new LinkedHashMap<>();
    private final Map<String, Integer> component = new LinkedHashMap<>();
    private final List<Set<String>> cycles = new ArrayList<>();

    /** edges: вызывающий → вызываемые. Узлы без рёбер тоже передаются ключом. */
    public CallGraph(Map<String, ? extends Set<String>> edges) {
        edges.forEach((from, tos) -> {
            out.computeIfAbsent(from, k -> new LinkedHashSet<>());
            in.computeIfAbsent(from, k -> new LinkedHashSet<>());
            for (String to : tos) {
                out.get(from).add(to);
                out.computeIfAbsent(to, k -> new LinkedHashSet<>());
                in.computeIfAbsent(to, k -> new LinkedHashSet<>()).add(from);
            }
        });
        tarjan();
    }

    public Set<String> methods() {
        return out.keySet();
    }

    public Set<String> callees(String id) {
        return out.getOrDefault(id, Set.of());
    }

    public Set<String> callers(String id) {
        return in.getOrDefault(id, Set.of());
    }

    /** Метод участвует в прямой или взаимной рекурсии. */
    public boolean isRecursive(String id) {
        Integer c = component.get(id);
        return c != null && c >= 0;
    }

    /** Вызов from → to замыкает рекурсию (оба в одном цикле). */
    public boolean sameCycle(String from, String to) {
        return isRecursive(from) && component.get(from).equals(component.get(to));
    }

    /** Циклы рекурсии (компоненты сильной связности с циклом) в порядке обнаружения. */
    public List<Set<String>> cycles() {
        return cycles;
    }

    // ponytail: рекурсивный Тарьян, на графах глубже ~несколько тысяч вызовов — переписать итеративно
    private int counter;
    private final Map<String, Integer> index = new LinkedHashMap<>();
    private final Map<String, Integer> low = new LinkedHashMap<>();
    private final Deque<String> stack = new ArrayDeque<>();
    private final Set<String> onStack = new LinkedHashSet<>();

    private void tarjan() {
        for (String v : out.keySet()) if (!index.containsKey(v)) strong(v);
    }

    private void strong(String v) {
        index.put(v, counter);
        low.put(v, counter++);
        stack.push(v);
        onStack.add(v);
        for (String w : out.get(v)) {
            if (!index.containsKey(w)) {
                strong(w);
                low.put(v, Math.min(low.get(v), low.get(w)));
            } else if (onStack.contains(w)) {
                low.put(v, Math.min(low.get(v), index.get(w)));
            }
        }
        if (!low.get(v).equals(index.get(v))) return;
        Set<String> scc = new LinkedHashSet<>();
        String w;
        do {
            w = stack.pop();
            onStack.remove(w);
            scc.add(w);
        } while (!w.equals(v));
        boolean cyclic = scc.size() > 1 || out.get(v).contains(v);
        int id = cyclic ? cycles.size() : -1;
        if (cyclic) cycles.add(scc);
        for (String s : scc) component.put(s, id);
    }
}
