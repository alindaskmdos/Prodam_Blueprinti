package blueprints.testing.io;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Set;
import org.junit.jupiter.api.Test;

class OutputComparatorTest {
    private final OutputComparator cmp = new OutputComparator();

    private OutputComparator.Comparison c(Observed e, Observed a) {
        return cmp.compare(e, a, Set.of());
    }

    @Test
    void equalOutputsMatch() {
        var r = c(new Observed("a\nb\n", 0, null), new Observed("a\nb\n", 0, null));
        assertTrue(r.matches());
        assertNull(r.error());
    }

    @Test
    void stdoutIsComparedByteByByte() {
        var crlf = c(new Observed("a\nb\n", 0, null), new Observed("a\r\nb\n", 0, null));
        assertFalse(crlf.matches());
        assertEquals("stdout, строка 1: ожидалось «a\\n», получено «a\\r\\n»", crlf.error());
        assertFalse(c(new Observed("a\n", 0, null), new Observed("a", 0, null)).matches());
        assertFalse(c(new Observed("a\n", 0, null), new Observed("a \n", 0, null)).matches());
        var extra = c(new Observed("a\n", 0, null), new Observed("a\nb\n", 0, null));
        assertEquals("stdout, строка 2: ожидалось <нет строки>, получено «b\\n»", extra.error());
    }

    @Test
    void exitCodeIsCompared() {
        var r = c(new Observed("x", 3, null), new Observed("x", 4, null));
        assertFalse(r.matches());
        assertEquals("код выхода: ожидался 3, получен 4", r.error());
    }

    @Test
    void exceptionComparedWithoutStackTrace() {
        String e1 = "Exception in thread \"main\" java.lang.IllegalStateException: boom\n"
                + "\tat A.f(A.java:3)\n\tat A.main(A.java:7)\n";
        String e2 = "Exception in thread \"main\" java.lang.IllegalStateException: boom\n"
                + "\tat A.g(A.java:10)\n\tat A.f(A.java:4)\n\tat A.main(A.java:9)\nCaused by: x\n\t... 2 more\n";
        assertEquals("java.lang.IllegalStateException: boom", Observed.uncaughtException(e1));
        assertTrue(c(new Observed("", 1, Observed.uncaughtException(e1)), new Observed("", 1, Observed.uncaughtException(e2))).matches());

        String other = "Exception in thread \"main\" java.lang.IllegalStateException: bang\n\tat A.f(A.java:3)\n";
        var r = c(new Observed("", 1, Observed.uncaughtException(e1)), new Observed("", 1, Observed.uncaughtException(other)));
        assertFalse(r.matches());
        assertTrue(r.error().startsWith("исключение: ожидалось «java.lang.IllegalStateException: boom»"), r.error());
        assertFalse(c(new Observed("", 1, "X"), new Observed("", 1, null)).matches());
    }

    @Test
    void uncaughtExceptionParsing() {
        assertNull(Observed.uncaughtException("just a warning\n"));
        assertNull(Observed.uncaughtException(null));
        assertEquals("Main$Bad", Observed.uncaughtException("log\nException in thread \"worker-1\" Main$Bad\n\tat Main.run(Main.java:1)\n"));
        assertEquals("java.lang.RuntimeException: line1\nline2",
                Observed.uncaughtException("Exception in thread \"main\" java.lang.RuntimeException: line1\nline2\n\tat M.main(M.java:1)\n"));
    }

    @Test
    void ignoredLinesAreSkipped() {
        var e = new Observed("time=1\nresult=5\n", 0, null);
        var a = new Observed("time=9\nresult=5\n", 0, null);
        assertFalse(cmp.compare(e, a, Set.of()).matches());
        assertTrue(cmp.compare(e, a, Set.of(1)).matches());
        var r = cmp.compare(e, new Observed("time=9\nresult=6\n", 0, null), Set.of(1));
        assertEquals("stdout, строка 2: ожидалось «result=5\\n», получено «result=6\\n»", r.error());
    }

    @Test
    void stdoutOnlyExpectationIgnoresExitAndException() {
        assertTrue(c(Observed.stdoutOnly("x\n"), new Observed("x\n", 3, "E: m")).matches());
    }

    @Test
    void allDifferencesAreReported() {
        var r = c(new Observed("a\n", 0, null), new Observed("b\n", 1, "E"));
        assertEquals(3, r.error().split("; ").length, r.error());
    }

    @Test
    void truncatedOutputNeverMatches() {
        var r = c(new Observed("x", 0, null), new Observed("x", 0, null, true));
        assertFalse(r.matches());
        assertEquals("вывод больше 1 МБ, сравнение невозможно", r.error());
        assertFalse(c(new Observed("x", 0, null, true), new Observed("x", 0, null)).matches());
    }
}
