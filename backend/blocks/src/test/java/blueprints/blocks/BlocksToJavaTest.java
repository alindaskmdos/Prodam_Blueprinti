package blueprints.blocks;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Block;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.CallableDeclaration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class BlocksToJavaTest {
    static {
        StaticJavaParser.getParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21);
    }

    static Block tree(String file, String id) {
        CompilationUnit cu = StaticJavaParser.parse(file);
        return AstToBlocks.convert(MethodLocator.find(cu, id).orElseThrow(), id, "T.java");
    }

    /** Тело метода m класса T, сгенерированное заново из его же блоков (принудительно). */
    static String regen(String body) {
        String indented = body.lines().map(l -> "        " + l).collect(java.util.stream.Collectors.joining("\n"));
        String file = "class T {\n    void m(int x) {\n" + indented + "\n    }\n}\n";
        CompilationUnit cu = StaticJavaParser.parse(file);
        CallableDeclaration<?> d = MethodLocator.find(cu, "T.m~0").orElseThrow();
        Block b = AstToBlocks.convert(d, "T.m~0", "T.java");
        String out = BlocksToJava.splice(file, d, b, b);
        Block again = tree(out, "T.m~0");
        assertTrue(BlocksToJava.sameTree(b, again), () -> "дерево изменилось:\n" + out);
        String head = "class T {\n    void m(int x) {\n";
        assertTrue(out.startsWith(head) && out.endsWith("    }\n}\n"), out);
        return out.substring(head.length(), out.length() - "    }\n}\n".length());
    }

    static Block with(Block b, String slot, List<Block> children) {
        Map<String, List<Block>> slots = new LinkedHashMap<>(b.slots());
        slots.put(slot, children);
        return new Block(b.id(), b.kind(), b.fields(), slots, b.span());
    }

    static Block leaf(String kind, String... kv) {
        Map<String, String> f = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) f.put(kv[i], kv[i + 1]);
        return new Block(null, kind, f, Map.of(), null);
    }

    @Test
    void everyKind() {
        assertEquals("""
                        final int a = x + 1;
                        int b;
                        b += a;
                        foo(a, b);
                        if (a > 0) {
                            return;
                        } else if (a < 0) {
                            throw new IllegalStateException();
                        } else {
                            b = 0;
                        }
                        while (b < 3) {
                            b++;
                            continue;
                        }
                        do {
                            b--;
                        } while (b > 0);
                        for (int i = 0, j = 1; i < 3; i++, j++) {
                            break;
                        }
                        for (;;) {
                            break;
                        }
                        for (final String s : java.util.List.of("q")) {
                            System.out.println(s);
                        }
                        synchronized (this) { b++; }
                        ;
                """, regen("""
                final int a = x + 1;
                int b;
                b += a;
                foo(a, b);
                if (a > 0) return; else if (a < 0) throw new IllegalStateException(); else b = 0;
                while (b < 3) { b++; continue; }
                do b--; while (b > 0);
                for (int i = 0, j = 1; i < 3; i++, j++) break;
                for (;;) break;
                for (final String s : java.util.List.of("q")) System.out.println(s);
                synchronized (this) { b++; }
                ;"""));
    }

    @Test
    void switchClassicAndArrow() {
        assertEquals("""
                        switch (x) {
                            // перед case
                            case 1:
                            case 2:
                                foo();
                                break;
                            default:
                                bar();
                        }
                        switch (x) {
                            case 1, 2 -> foo();
                            case 3 -> throw new RuntimeException();
                            case 4 -> {
                                foo();
                                bar();
                            }
                            default -> {
                            }
                        }
                """, regen("""
                switch (x) {
                  // перед case
                  case 1: case 2: foo(); break;
                  default: bar();
                }
                switch (x) {
                  case 1, 2 -> foo();
                  case 3 -> throw new RuntimeException();
                  case 4 -> { foo(); bar(); }
                  default -> {}
                }"""));
    }

    @Test
    void tryWithCommentsInCatchesSlot() {
        assertEquals("""
                        try (var r = new java.io.StringReader("")) {
                            r.read();
                        }
                        // перед catch
                        catch (java.io.IOException | RuntimeException e) {
                            foo();
                        }
                        // перед finally
                        finally {
                            bar();
                        }
                        try {
                            foo();
                        } finally {
                        }
                """, regen("""
                try (var r = new java.io.StringReader("")) { r.read(); }
                // перед catch
                catch (java.io.IOException | RuntimeException e) { foo(); }
                // перед finally
                finally { bar(); }
                try { foo(); } finally { }"""));
    }

    @Test
    void commentsBecomeOwnLines() {
        assertEquals("""
                        int a = 1;
                        // в конце строки
                        /* многострочный
                           второй */
                        /*
                         * javadoc-стиль
                         * строка
                         */
                        foo(/* в выражении */ a);
                        /* блочный в строку */
                        /** javadoc в строку */
                        x++;
                        /* в конце строки блочный */
                """, regen("""
                int a = 1; // в конце строки
                /* многострочный
                   второй */
                /*
                 * javadoc-стиль
                 * строка
                 */
                foo(/* в выражении */ a);
                /* блочный в строку */
                /** javadoc в строку */
                x++; /* в конце строки блочный */"""));
    }

    @Test
    void commentWithCloseMarkerAndEmpty() {
        String file = "class T {\n    void m() {\n    }\n}\n";
        Block m = tree(file, "T.m~0");
        Block edited = with(m, "body", List.of(leaf("comment", "text", "a */ b\nc"), leaf("comment", "text", "")));
        String out = BlocksToJava.replaceMethod(file, "T.m~0", edited);
        assertEquals("class T {\n    void m() {\n        // a */ b\n        // c\n        //\n    }\n}\n", out);
        StaticJavaParser.parse(out);
    }

    @Test
    void unchangedTreeIsByteExact() throws Exception {
        String file = Files.readString(Path.of("../../samples/demo/src/com/demo/service/OrderService.java"));
        String id = "com.demo.service.OrderService.merge~0";
        assertEquals(file, BlocksToJava.replaceMethod(file, id, tree(file, id)));
    }

    /** Меняется только тело одного метода: текст до и после него — байт в байт. */
    @Test
    void onlyEditedMethodChanges() {
        String file = "class T {\n\tint a() {   return   1 ; }\n\n\t// c\n\tint b() { return 2; }\n\tint z() {  return 3 ;}\n}\n";
        Block b = tree(file, "T.b~0");
        Block edited = with(b, "body", List.of(leaf("var", "type", "int", "name", "v", "init", "20"), leaf("return", "value", "v")));
        String out = BlocksToJava.replaceMethod(file, "T.b~0", edited);
        assertEquals("class T {\n\tint a() {   return   1 ; }\n\n\t// c\n\tint b() {\n\t\tint v = 20;\n\t\treturn v;\n\t}\n"
                + "\tint z() {  return 3 ;}\n}\n", out);
    }

    @Test
    void crlfFileStaysCrlf() {
        String file = "class T {\r\n    void m() {\r\n        if (true) foo();\r\n        String s = \"\"\"\r\n            hi\r\n            \"\"\";\r\n    }\r\n}\r\n";
        Block m = tree(file, "T.m~0");
        Block edited = with(m, "body", new ArrayList<>(m.slots().get("body")) {{ add(leaf("expr", "text", "bar()")); }});
        String out = BlocksToJava.replaceMethod(file, "T.m~0", edited);
        assertFalse(out.replace("\r\n", "").contains("\n"), out);
        assertTrue(out.contains("        if (true) {\r\n            foo();\r\n        }\r\n"), out);
        assertTrue(out.contains("        bar();\r\n    }\r\n}\r\n"), out);
    }

    @Test
    void signatureChangeAndCtorAndOverloadAndNested() {
        String file = "package p;\nclass T {\n    T() { }\n    T(int x) { }\n    void m() { }\n    /** doc */\n    @Deprecated void m(int x) { }\n"
                + "    static class In { void run() { } }\n    abstract static class Ab { abstract int f(); }\n}\n";
        assertTrue(MethodLocator.find(StaticJavaParser.parse(file), "p.T.<init>~1").isPresent());
        assertTrue(MethodLocator.find(StaticJavaParser.parse(file), "p.T$In.run~0").isPresent());
        assertFalse(MethodLocator.find(StaticJavaParser.parse(file), "p.T.m~2").isPresent());
        assertFalse(MethodLocator.find(StaticJavaParser.parse(file), "p.T.nope~0").isPresent());

        Block m1 = tree(file, "p.T.m~1");
        Map<String, String> f = new LinkedHashMap<>(m1.fields());
        f.put("signature", "@Deprecated int m(int x, int y)");
        Block edited = new Block(m1.id(), "method", f, Map.of("body", List.of(leaf("return", "value", "x + y"))), null);
        String out = BlocksToJava.replaceMethod(file, "p.T.m~1", edited);
        assertTrue(out.contains("    /** doc */\n    @Deprecated int m(int x, int y) {\n        return x + y;\n    }\n"), out);

        Block ab = tree(file, "p.T$Ab.f~0");
        Map<String, String> g = new LinkedHashMap<>(ab.fields());
        g.put("signature", "abstract long f()");
        String out2 = BlocksToJava.replaceMethod(file, "p.T$Ab.f~0", new Block(null, "method", g, Map.of("body", List.of()), null));
        assertTrue(out2.contains("abstract static class Ab { abstract long f(); }"), out2);
        assertThrows(IllegalArgumentException.class, () -> BlocksToJava.replaceMethod(file, "p.T$Ab.f~0",
                new Block(null, "method", g, Map.of("body", List.of(leaf("return", "value", "1"))), null)));

        Block c = tree(file, "p.T.<init>~0");
        String out3 = BlocksToJava.replaceMethod(file, "p.T.<init>~0", with(c, "body", List.of(leaf("raw", "text", "this(1);"))));
        assertTrue(out3.contains("    T() {\n        this(1);\n    }\n    T(int x) { }"), out3);
        assertThrows(IllegalArgumentException.class, () -> BlocksToJava.replaceMethod(file, "p.T.zz~0", c));
    }

    @Test
    void newBlocksWithoutSpanAndIds() {
        String file = "class T {\n    int m(java.util.List<Integer> xs) {\n        return 0;\n    }\n}\n";
        Block m = tree(file, "T.m~0");
        Block loop = new Block(null, "foreach", Map.of("type", "int", "var", "v", "iterable", "xs"),
                Map.of("body", List.of(leaf("assign", "target", "s", "op", "+=", "value", "v"))), null);
        Block edited = with(m, "body", List.of(leaf("var", "type", "int", "name", "s", "init", "0"), loop, leaf("return", "value", "s")));
        String out = BlocksToJava.replaceMethod(file, "T.m~0", edited);
        assertEquals("class T {\n    int m(java.util.List<Integer> xs) {\n        int s = 0;\n        for (int v : xs) {\n"
                + "            s += v;\n        }\n        return s;\n    }\n}\n", out);
    }

    static void compiles(String className, String src) throws Exception {
        javax.tools.JavaCompiler jc = javax.tools.ToolProvider.getSystemJavaCompiler();
        java.io.StringWriter err = new java.io.StringWriter();
        javax.tools.JavaFileObject fo = new javax.tools.SimpleJavaFileObject(
                java.net.URI.create("string:///" + className + ".java"), javax.tools.JavaFileObject.Kind.SOURCE) {
            @Override
            public CharSequence getCharContent(boolean ignore) {
                return src;
            }
        };
        Path out = Files.createTempDirectory("b2j");
        boolean ok = jc.getTask(err, null, null, List.of("--release", "21", "-d", out.toString()), null, List.of(fo)).call();
        assertTrue(ok, () -> err + "\n" + src);
    }

    /**
     * Комментарии — ровно в исходном виде: // остаётся //, /* *\/ остаётся /* *\/, текст (в т.ч. \u000a и \\u000a)
     * не меняется; повторные правки идемпотентны, результат проходит javac.
     */
    @Test
    void commentsKeepExactFormAcrossEdits() throws Exception {
        String file = "class T {\n    void m() {\n        // a */ b\n        /* \\u000a */\n        /* p \\\\u000a q */\n"
                + "        int x = 1; // хвост \\\\u000d\n    }\n}\n";
        compiles("T", file);
        String text = file;
        String first = null;
        for (int pass = 0; pass < 3; pass++) {
            Block m = tree(text, "T.m~0");
            assertEquals(List.of("comment", "comment", "comment", "var", "comment"),
                    m.slots().get("body").stream().map(Block::kind).limit(5).toList());
            List<Block> body = new ArrayList<>(m.slots().get("body"));
            if (pass == 0) body.add(leaf("expr", "text", "x++"));
            String out = BlocksToJava.replaceMethod(text, "T.m~0", with(m, "body", body));
            if (pass == 0) {
                assertEquals("class T {\n    void m() {\n        // a */ b\n        /* \\u000a */\n        /* p \\\\u000a q */\n"
                        + "        int x = 1;\n        // хвост \\\\u000d\n        x++;\n    }\n}\n", out);
                first = out;
            } else {
                assertEquals(first, out, "проход " + pass); // то же дерево -> тот же текст
                // принудительная перегенерация из того же дерева — тоже тот же текст
                var cu = com.github.javaparser.StaticJavaParser.parse(out);
                var d = MethodLocator.find(cu, "T.m~0").orElseThrow();
                Block b = AstToBlocks.convert(d, "T.m~0", "T.java");
                assertEquals(first, BlocksToJava.splice(out, d, b, b), "splice, проход " + pass);
            }
            compiles("T", out);
            text = out;
        }
    }

    /** Фронт может не прислать signature: неизменённый метод — байт в байт, изменённый — заголовок исходный. */
    @Test
    void missingSignatureMeansUnchangedHeader() {
        String file = "class T {\n    /** d */ public   int m( int x ) {  return x ; }\n}\n";
        Block m = tree(file, "T.m~0");
        Map<String, String> noSig = new LinkedHashMap<>(m.fields());
        noSig.remove("signature");
        Block same = new Block(null, "method", noSig, m.slots(), null);
        assertEquals(file, BlocksToJava.replaceMethod(file, "T.m~0", same));
        Block edited = new Block(null, "method", noSig, Map.of("body", List.of(leaf("return", "value", "x + 1"))), null);
        assertEquals("class T {\n    /** d */ public   int m( int x ) {\n        return x + 1;\n    }\n}\n",
                BlocksToJava.replaceMethod(file, "T.m~0", edited));
    }

    /** BOM в начале файла: неизменённое — байт в байт, правка одного метода не сдвигает остальной текст. */
    @Test
    void bomFileByteExact() {
        String file = "\uFEFFclass T {\n    int a() { return 1; }\n    int b() { return 2; }\n}\n";
        assertEquals(file, BlocksToJava.replaceMethod(file, "T.b~0", tree(file, "T.b~0")));
        Block b = tree(file, "T.b~0");
        String out = BlocksToJava.replaceMethod(file, "T.b~0", with(b, "body", List.of(leaf("return", "value", "3"))));
        assertEquals("\uFEFFclass T {\n    int a() { return 1; }\n    int b() {\n        return 3;\n    }\n}\n", out);
    }

    /** \\uXXXX в исходнике (до метода и в нём) не раскрывается: текст сохраняется как в файле. */
    @Test
    void unicodeEscapesInSourceByteExact() throws Exception {
        String file = "class T {\n    String f = \"\\u0041\\u00e9\";\n    char a() { return '\\u0042'; }\n"
                + "    String b() { String s = \"\\u0043\"; return s; }\n}\n";
        assertEquals(file, BlocksToJava.replaceMethod(file, "T.a~0", tree(file, "T.a~0")));
        assertEquals(file, BlocksToJava.replaceMethod(file, "T.b~0", tree(file, "T.b~0")));
        Block b = tree(file, "T.b~0");
        List<Block> body = new ArrayList<>(b.slots().get("body"));
        body.add(0, leaf("expr", "text", "System.out.print(\"\\u0044\")"));
        String out = BlocksToJava.replaceMethod(file, "T.b~0", with(b, "body", body));
        assertEquals("class T {\n    String f = \"\\u0041\\u00e9\";\n    char a() { return '\\u0042'; }\n"
                + "    String b() {\n        System.out.print(\"\\u0044\");\n        String s = \"\\u0043\";\n        return s;\n    }\n}\n", out);
        compiles("T", out);
    }

    /** Новый/изменённый комментарий с unicode-escape не генерируется, неизменённый — как в исходнике. */
    @Test
    void unsafeNewCommentRejected() throws Exception {
        String file = "class T {\n    void m() {\n        /* a \\u000a b */\n        int x = 1;\n    }\n}\n";
        String before = file;
        Block m = tree(file, "T.m~0");
        Block c = m.slots().get("body").get(0);
        // изменённый: "a" -> "c"
        Block edited = new Block(c.id(), "comment", Map.of("text", "c \\u000a b"), Map.of(), c.span());
        Block t1 = with(m, "body", List.of(edited, m.slots().get("body").get(1)));
        UnsafeCommentException e = assertThrows(UnsafeCommentException.class, () -> BlocksToJava.replaceMethod(file, "T.m~0", t1));
        assertEquals("T.m~0/body/0", e.blockId());
        assertTrue(e.getMessage().contains("Комментарий содержит \\u-escape — уберите его"), e.getMessage());
        assertEquals(before, file);
        // новый с палитры (без id), любой unicode-escape
        List<Block> body = new ArrayList<>(m.slots().get("body"));
        body.add(leaf("comment", "text", "x \\u0041"));
        assertThrows(UnsafeCommentException.class, () -> BlocksToJava.replaceMethod(file, "T.m~0", with(m, "body", body)));
        // неизменённый при правке соседнего кода — проходит и компилируется
        List<Block> ok = new ArrayList<>(m.slots().get("body"));
        ok.add(leaf("expr", "text", "x++"));
        String out = BlocksToJava.replaceMethod(file, "T.m~0", with(m, "body", ok));
        assertEquals("class T {\n    void m() {\n        /* a \\u000a b */\n        int x = 1;\n        x++;\n    }\n}\n", out);
        compiles("T", out);
    }

    /**
     * Комментарий с \\u-escape внутри выражения и raw остаётся в их тексте; новый comment-блок с тем же текстом —
     * новый, а не «исходный»: генератор его не выводит.
     */
    @Test
    void commentInsideExpressionIsNotAnOriginalForNewBlock() {
        String file = "class T {\n    void m(int x) {\n        foo(x // a \\u0041\n        );\n"
                + "        synchronized (this) { x++; /* b \\u0042 */ }\n    }\n    void foo(int x) {}\n}\n";
        CompilationUnit cu = StaticJavaParser.parse(file);
        CallableDeclaration<?> d = MethodLocator.find(cu, "T.m~0").orElseThrow();
        Block m = AstToBlocks.convert(d, "T.m~0", "T.java");
        assertEquals(List.of("expr", "raw"), m.slots().get("body").stream().map(Block::kind).toList());
        for (String text : List.of("a \\u0041", "b \\u0042")) {
            List<Block> body = new ArrayList<>(m.slots().get("body"));
            body.add(leaf("comment", "text", text));
            assertThrows(UnsafeCommentException.class, () -> BlocksToJava.splice(file, d, with(m, "body", body), m), text);
        }
    }

    @Test
    void newCommentsWithoutEscapesCompile() throws Exception {
        String file = "class T {\n    void m() {\n    }\n}\n";
        Block m = tree(file, "T.m~0");
        String out = BlocksToJava.replaceMethod(file, "T.m~0", with(m, "body", List.of(
                leaf("comment", "text", "одна строка */ тут"), leaf("comment", "text", "две\nстроки"),
                leaf("comment", "text", "с */ внутри\nвторая"), leaf("expr", "text", "System.out.println()"))));
        assertEquals("class T {\n    void m() {\n        // одна строка */ тут\n        /* две\nстроки */\n"
                + "        // с */ внутри\n        // вторая\n        System.out.println();\n    }\n}\n", out);
        compiles("T", out);
    }
}
