package blueprints.testing;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Map;
import org.junit.jupiter.api.Test;

class StdinUsageTest {

    private static boolean reads(String code) {
        return StdinUsage.readsStdin(Map.of("Main.java", code));
    }

    @Test
    void detectsStdinReaders() {
        assertTrue(reads("class M { java.util.Scanner s = new java.util.Scanner(System.in); }"));
        assertTrue(reads("class M { Object r = new BufferedReader(new InputStreamReader(System . in, UTF_8)); }"));
        assertTrue(reads("class M { void f() throws Exception { System.in.read(); } }"));
        assertTrue(reads("class M { String l = System.console().readLine(); }"));
        assertTrue(reads("import static java.lang.System.in;\nclass M {}"));
    }

    @Test
    void ignoresCommentsLiteralsAndLookalikes() {
        assertFalse(reads("class M { // new Scanner(System.in)\n }"));
        assertFalse(reads("class M { /* System.in */ String s = \"System.in\"; char c = '\"'; }"));
        assertFalse(reads("class M { String t = \"\"\"\n  System.in\n  \"\"\"; }"));
        assertFalse(reads("class M { Object c = System.inheritedChannel(); Object o = System.out; }"));
        assertFalse(reads("class M { String s = \"a\\\"System.in\"; }"), "экранированная кавычка не закрывает строку");
    }
}
