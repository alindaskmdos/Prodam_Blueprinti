package blueprints.blocks;

import static blueprints.blocks.BlocksToJavaTest.leaf;
import static blueprints.blocks.BlocksToJavaTest.tree;
import static blueprints.blocks.BlocksToJavaTest.with;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Block;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class NodeValidatorTest {
    static final String FILE = "class T {\n    T(int x) { super(); }\n    int m(int x) {\n        String s = \"\\u00e9\";\n"
            + "        switch (x) {\n            case 1:\n                x++;\n        }\n        try {\n            x--;\n"
            + "        } catch (RuntimeException e) {\n        }\n        return x;\n    }\n}\n";

    static Block m() {
        return tree(FILE, "T.m~0");
    }

    /** m с дополнительным оператором в конце тела. */
    static Block plus(Block extra) {
        List<Block> body = new ArrayList<>(m().slots().get("body"));
        body.add(extra);
        return with(m(), "body", body);
    }

    static InvalidNodeException rejected(Block tree) {
        return assertThrows(InvalidNodeException.class, () -> NodeValidator.validate(tree, m()));
    }

    static void ok(Block tree) {
        assertDoesNotThrow(() -> NodeValidator.validate(tree, m()));
    }

    static Block node(String kind, Map<String, List<Block>> slots, String... kv) {
        Block l = leaf(kind, kv);
        return new Block(null, kind, l.fields(), slots, null);
    }

    @Test
    void validNodesOfEveryKind() {
        ok(m());
        ok(tree(FILE, "T.<init>~0"));
        ok(plus(leaf("var", "type", "final int", "name", "y", "init", "x /* c */ + 1")));
        ok(plus(leaf("var", "type", "int", "name", "z")));
        ok(plus(leaf("assign", "target", "x", "op", "+=", "value", "2")));
        ok(plus(leaf("expr", "text", "System.out.println(x)")));
        ok(plus(node("if", Map.of("then", List.of(leaf("break")), "else", List.of()), "cond", "x > 0")));
        ok(plus(node("for", Map.of("body", List.of(leaf("continue"))), "init", "int i = 0", "cond", "i < x", "update", "i++")));
        ok(plus(node("foreach", Map.of(), "type", "var", "var", "c", "iterable", "s.toCharArray()")));
        ok(plus(node("while", Map.of(), "cond", "x-- > 0")));
        ok(plus(node("dowhile", Map.of(), "cond", "x-- > 0")));
        ok(plus(node("switch", Map.of("cases", List.of(node("case", Map.of("body", List.of(leaf("expr", "text", "x++"))),
                "label", "1, 2", "arrow", "true"), leaf("comment", "text", "c"), leaf("case", "label", "default", "arrow", "true"))),
                "selector", "x")));
        ok(plus(node("try", Map.of("catches", List.of(leaf("catch", "type", "IllegalStateException | ArithmeticException", "var", "e"))),
                "resources", "var r = new java.io.StringReader(s)")));
        ok(plus(leaf("throw", "value", "new IllegalStateException()")));
        ok(plus(leaf("raw", "text", "assert x > 0 : \"x\";")));
        ok(plus(leaf("raw", "text", "int a = 1, b = 2;")));
        ok(plus(leaf("comment", "text", "многострочный\nкомментарий */ с концом")));
        ok(plus(leaf("expr", "text", "s = \"C:\\\\users\"")));  // \\u в строке — не unicode-escape
    }

    @Test
    void syntaxErrorsAreRejectedWithBlockId() {
        InvalidNodeException e = rejected(plus(leaf("expr", "text", "foo(")));
        assertEquals("T.m~0/body/4", e.blockId());
        assertTrue(e.getMessage().startsWith("Синтаксическая ошибка"), e.getMessage());
        rejected(plus(leaf("var", "type", "int", "name", "1y")));
        rejected(plus(leaf("assign", "target", "x", "op", "=", "value", "")));
        rejected(plus(node("if", Map.of(), "cond", "x >")));
        rejected(plus(leaf("return", "value", "x x")));
        // // в выражении съел бы ; и следующую строку
        rejected(plus(leaf("expr", "text", "foo() // хвост")));
        rejected(plus(node("for", Map.of(), "init", "int i = 0", "cond", "i < x // c", "update", "i++")));
    }

    @Test
    void textMustStayInsideItsStatement() {
        rejected(plus(leaf("expr", "text", "a(); b()")));
        rejected(plus(node("if", Map.of(), "cond", "x) {} if (x")));
        rejected(plus(leaf("raw", "text", "} void evil() {")));
        rejected(plus(node("switch", Map.of("cases", List.of(leaf("case", "label", "1: x++; case 2"))), "selector", "x")));
        rejected(new Block("T.m~0", "method", Map.of("signature", "int m(int x) {} int n()"), m().slots(), null));
        ok(new Block("T.m~0", "method", Map.of("signature", "public int m(int x, int y)"), m().slots(), null));
    }

    @Test
    void structureIsChecked() {
        // нода с неизвестным kind и нода не на своём месте
        rejected(plus(leaf("goto", "text", "x++;")));
        rejected(plus(leaf("case", "label", "1")));
        rejected(plus(leaf("catch", "type", "Exception", "var", "e")));
        rejected(plus(node("switch", Map.of("cases", List.of(leaf("expr", "text", "x++"))), "selector", "x")));
        // содержимое неизвестного слота потерялось бы при генерации
        rejected(plus(node("if", Map.of("body", List.of(leaf("break"))), "cond", "x > 0")));
        rejected(plus(node("expr", Map.of("body", List.of(leaf("break"))), "text", "x++")));
        assertThrows(InvalidNodeException.class, () -> NodeValidator.validate(leaf("expr", "text", "x"), m()));
    }

    /** Новый/изменённый текст с unicode-escape отклоняется, совпавший с исходным — нет. */
    @Test
    void unicodeEscapes() {
        assertTrue(NodeValidator.hasUnicodeEscape("a\\u000a"));
        assertTrue(NodeValidator.hasUnicodeEscape("\\\\\\uuu0041"));
        assertFalse(NodeValidator.hasUnicodeEscape("C:\\\\users"));
        assertFalse(NodeValidator.hasUnicodeEscape(null));

        InvalidNodeException e = rejected(plus(leaf("expr", "text", "System.out.print(\"\\u0044\")")));
        assertEquals("T.m~0/body/4", e.blockId());
        assertTrue(e.getMessage().contains("\\u-escape"), e.getMessage());
        rejected(plus(leaf("var", "type", "String", "name", "q", "init", "\"\\u0022\"")));
        rejected(plus(leaf("raw", "text", "x++; // \\u000a x--;")));
        assertTrue(rejected(plus(leaf("comment", "text", "c \\u0041"))) instanceof UnsafeCommentException);
        // неизменённый исходный "\u00e9" и его копия — допустимы
        ok(plus(leaf("var", "type", "String", "name", "s2", "init", "\"\\u00e9\"")));
    }

    /** Новые ноды без id получают позиционный id от родителя. */
    @Test
    void positionalIdsForNewNodes() {
        Block inner = node("if", Map.of("then", List.of(leaf("expr", "text", "bad("))), "cond", "x > 0");
        assertEquals("T.m~0/body/4/then/0", rejected(plus(inner)).blockId());
        Map<String, String> noId = new LinkedHashMap<>(m().fields());
        Block root = new Block(null, "method", noId, Map.of("body", List.of(leaf("expr", "text", "bad("))), null);
        assertEquals("/body/0", rejected(root).blockId());
    }
}
