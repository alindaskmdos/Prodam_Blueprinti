package blueprints.analysis;

import static blueprints.analysis.JdkCosts.Cost.*;
import static blueprints.analysis.JdkCosts.lookup;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

class JdkCostsTest {
    @Test
    void table() {
        assertEquals(LINEAR, lookup("ArrayList", "contains", 1));
        assertEquals(LINEAR, lookup("List", "indexOf", 1));
        assertEquals(LINEAR, lookup("ArrayList", "remove", 1));
        assertNull(lookup("ArrayList", "get", 1));
        assertEquals(LINEAR, lookup("LinkedList", "get", 1));
        assertEquals(CONSTANT, lookup("HashMap", "get", 1));
        assertEquals(CONSTANT, lookup("LinkedHashSet", "contains", 1));
        assertEquals(LINEAR, lookup("HashMap", "containsValue", 1));
        assertEquals(LOG, lookup("TreeMap", "get", 1));
        assertEquals(LOG, lookup("TreeSet", "contains", 1));
        assertEquals(N_LOG_N, lookup("Collections", "sort", 1));
        assertEquals(N_LOG_N, lookup("List", "sort", 1));
        assertEquals(LINEAR, lookup("String", "contains", 1));
        assertNull(lookup("ArrayDeque", "remove", 0));
        assertNull(lookup("Order", "contains", 1));
        assertNull(lookup(null, "contains", 1));
    }

    @Test
    void costInTermsOfReceiver() {
        BigO n = BigO.of("n");
        assertEquals(n, JdkCosts.cost("List", "contains", 1, n));
        assertEquals(BigO.ONE, JdkCosts.cost("HashSet", "add", 1, n));
        assertEquals("O(log n)", JdkCosts.cost("TreeMap", "put", 2, n).raw());
        assertEquals("O(n log n)", JdkCosts.cost("Arrays", "sort", 1, n).raw());
    }
}
