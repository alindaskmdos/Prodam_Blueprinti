package blueprints.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;

class BigOTest {
    static final BigO N = BigO.of("n"), M = BigO.of("m");

    @Test
    void sequenceIsMax() {
        assertEquals(N, N.plus(BigO.ONE));
        assertEquals(N.times(N), N.plus(N.times(N)));
        assertEquals("O(m + n)", N.plus(M).raw()); // нормальная форма: порядок слагаемых не зависит от порядка сложения
        assertEquals(N.plus(M), M.plus(N));
    }

    @Test
    void nestingIsProduct() {
        assertEquals("O(n²)", N.times(N).raw());
        assertEquals("O(m·n)", N.times(M).raw());
        assertEquals("O(n³)", N.times(N).times(N).raw());
        assertEquals(N, N.times(BigO.ONE));
        assertEquals("O(1)", BigO.ONE.times(BigO.ONE).toString());
    }

    @Test
    void logs() {
        BigO nLogN = N.times(N.log());
        assertEquals("O(n log n)", nLogN.raw());
        assertEquals(N.times(N), N.times(N).plus(nLogN));
        assertEquals(nLogN, nLogN.plus(N));
        assertEquals("O(n + log m)", N.plus(M.log()).raw());
        assertEquals(BigO.ONE, BigO.ONE.log());
        assertEquals("O(log m + log n)", N.times(N).times(M).log().raw());
    }

    @Test
    void displayRenamesSymbols() {
        BigO x = BigO.of("orders").times(BigO.of("orders"));
        assertEquals("O(orders²)", x.raw());
        assertEquals("O(n²)", x.toString());
        assertEquals("O(n·m)", BigO.of("a").times(BigO.of("b")).toString());
        assertEquals("O(n log n)", BigO.of("xs").times(BigO.log("xs")).toString());
        BigO merge = BigO.of("x|a").times(BigO.of("x|c")).times(BigO.of("x|b")).times(BigO.of("x|b"));
        assertEquals("O(n²·m·k)", merge.toString());
        assertEquals("O(b²·a·c)", merge.raw());
        assertEquals(merge.toString(), BigO.of("x|b").times(BigO.of("x|c")).times(BigO.of("x|a")).times(BigO.of("x|b")).toString());
        BigO many = BigO.of("a").times(BigO.of("a")).plus(BigO.of("b")).plus(BigO.of("c")).plus(BigO.of("d"));
        assertEquals("O(n² + m + k + …)", many.toString());
        assertEquals("O(a² + b + c + d)", many.raw());
    }

    @Test
    void substitution() {
        BigO callee = BigO.of("a").times(BigO.of("b"));
        assertEquals("O(n²)", callee.substitute(Map.of("a", N, "b", N)).raw());
        assertEquals("O(n)", callee.substitute(Map.of("a", N, "b", BigO.ONE)).raw());
        assertEquals("O(n log n)", BigO.of("a").times(BigO.log("a")).substitute(Map.of("a", N)).raw());
        assertEquals(BigO.of("a"), BigO.of("a").substitute(Map.of()));
    }

    @Test
    void predicatesAndOps() {
        assertTrue(BigO.ONE.isConstant());
        assertFalse(N.log().isAtLeastLinear());
        assertTrue(N.isAtLeastLinear());
        assertEquals(1e8, N.times(M).ops(10_000), 1);
        assertEquals(1e4, N.ops(10_000), 1e-6);
        assertEquals(1, BigO.ONE.ops(10_000), 1e-9);
    }
}
