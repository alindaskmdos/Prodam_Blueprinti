package blueprints.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class CallGraphTest {
    @Test
    void edgesCyclesAndSelfLoops() {
        Map<String, Set<String>> e = new LinkedHashMap<>();
        e.put("main", Set.of("a"));
        e.put("a", Set.of("b"));
        e.put("b", Set.of("a", "leaf"));
        e.put("fact", Set.of("fact"));
        e.put("leaf", Set.of());
        CallGraph g = new CallGraph(e);

        assertEquals(Set.of("b"), g.callees("a"));
        assertEquals(Set.of("main", "b"), g.callers("a"));
        assertTrue(g.isRecursive("a"));
        assertTrue(g.isRecursive("b"));
        assertTrue(g.isRecursive("fact"));
        assertFalse(g.isRecursive("main"));
        assertFalse(g.isRecursive("leaf"));
        assertTrue(g.sameCycle("b", "a"));
        assertFalse(g.sameCycle("b", "leaf"));
        assertFalse(g.sameCycle("a", "fact"));
        assertEquals(2, g.cycles().size());
        assertEquals(List.of("main", "a", "b", "leaf", "fact"), List.copyOf(g.methods()));
    }

    @Test
    void unknownNodeIsHarmless() {
        CallGraph g = new CallGraph(Map.of());
        assertTrue(g.callees("x").isEmpty());
        assertFalse(g.isRecursive("x"));
    }
}
