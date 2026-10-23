package blueprints.blocks;

import blueprints.model.Block;
import com.github.javaparser.JavaParser;
import com.github.javaparser.ParseResult;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.BodyDeclaration;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.stmt.Statement;
import com.github.javaparser.ast.stmt.SwitchStmt;
import com.github.javaparser.ast.stmt.TryStmt;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Проверка дерева метода перед генерацией (§5 ТЗ): каждая нода печатается тем же {@link BlocksToJava} (без детей)
 * в обёртке {@code class __V { __V() { ... } }} и разбирается JavaParser — это строже parseExpression/parseStatement:
 * ловит и {@code //} в выражении, съедающий {@code ;}, и текст, вылезающий за свой оператор. Плюс структура
 * (kind по месту, слоты по kind — иначе содержимое слота потерялось бы при генерации) и unicode-escape:
 * новый/изменённый текст с {@code \\uXXXX} отклоняется (javac раскрывает его до разбора, в т.ч. {@code \\u000a}),
 * текст, совпавший с исходным текстом метода, — нет.
 */
public final class NodeValidator {
    private static final String V = "__V";
    private static final Set<String> STATEMENTS = Set.of("var", "assign", "expr", "if", "while", "dowhile", "for",
            "foreach", "switch", "try", "return", "throw", "break", "continue", "comment", "raw");
    private static final Map<String, Set<String>> SLOTS = Map.of(
            "method", Set.of("body"), "if", Set.of("then", "else"), "while", Set.of("body"), "dowhile", Set.of("body"),
            "for", Set.of("body"), "foreach", Set.of("body"), "switch", Set.of("cases"), "case", Set.of("body"),
            "try", Set.of("body", "catches", "finally"), "catch", Set.of("body"));

    private final JavaParser parser = new JavaParser(new ParserConfiguration()
            .setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21));
    /** Тексты полей исходного метода: с unicode-escape разрешены только они (комментарии — отдельно). */
    private final Set<String> originalTexts = new LinkedHashSet<>();
    private final Set<String> originalComments = new LinkedHashSet<>();
    private final String originalSignature;

    private NodeValidator(Block current) {
        this.originalSignature = current.fields().get("signature");
        collect(current);
    }

    /**
     * @param tree    новое дерево (root kind=method); id root — id метода, от него строятся id новых нод без id
     * @param current дерево метода из исходника ({@link AstToBlocks#convert})
     * @throws InvalidNodeException первая неверная нода (обход в порядке дерева)
     */
    public static void validate(Block tree, Block current) {
        NodeValidator v = new NodeValidator(current);
        String id = blank(tree.id()) ? "" : tree.id();
        if (!"method".equals(tree.kind())) throw new InvalidNodeException(id, "корень дерева должен быть kind=method");
        v.check(tree, id);
    }

    /** Есть ли в тексте unicode-escape: {@code \}, перед которым чётное число {@code \}, и затем {@code u}. */
    public static boolean hasUnicodeEscape(String s) {
        if (s == null) return false;
        int slashes = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == 'u' && slashes % 2 == 1) return true;
            slashes = c == '\\' ? slashes + 1 : 0;
        }
        return false;
    }

    private void collect(Block b) {
        (b.kind().equals("comment") ? originalComments : originalTexts).addAll(b.fields().values());
        b.slots().values().forEach(l -> l.forEach(this::collect));
    }

    private void check(Block b, String id) {
        for (String v : b.fields().values()) {
            if (!hasUnicodeEscape(v)) continue;
            if (b.kind().equals("comment")) {
                if (!originalComments.contains(v)) throw new UnsafeCommentException(id, v);
            } else if (!originalTexts.contains(v)) {
                throw new InvalidNodeException(id, "Текст содержит \\u-escape — уберите его (javac раскрывает его до разбора): " + v);
            }
        }
        if (b.kind().equals("method")) {
            String sig = b.fields().get("signature");
            if (sig != null && !sig.equals(originalSignature)) signature(sig, id);
        } else if (!b.kind().equals("comment")) {
            syntax(b, id);
        }
        Set<String> allowed = SLOTS.getOrDefault(b.kind(), Set.of());
        b.slots().forEach((slot, children) -> {
            if (children == null || children.isEmpty()) return;
            if (!allowed.contains(slot)) throw new InvalidNodeException(id, "у " + b.kind() + " нет слота " + slot);
            for (int i = 0; i < children.size(); i++) {
                Block c = children.get(i);
                String cid = c == null || blank(c.id()) ? id + "/" + slot + "/" + i : c.id();
                if (c == null || c.kind() == null) throw new InvalidNodeException(cid, "у ноды нет kind");
                boolean ok = switch (b.kind() + "." + slot) {
                    case "switch.cases" -> c.kind().equals("case") || c.kind().equals("comment");
                    case "try.catches" -> c.kind().equals("catch") || c.kind().equals("comment");
                    default -> STATEMENTS.contains(c.kind());
                };
                if (!ok) throw new InvalidNodeException(cid, "нода " + c.kind() + " не может стоять в " + b.kind() + "." + slot);
                check(c, cid);
            }
        });
    }

    /** Нода без детей печатается генератором в теле конструктора и должна разобраться ровно в один свой оператор. */
    private void syntax(Block b, String id) {
        Block alone = new Block(b.id(), b.kind(), b.fields(), Map.of(), null);
        Block stmt = switch (b.kind()) {
            case "case" -> new Block(null, "switch", Map.of("selector", V), Map.of("cases", List.of(alone)), null);
            case "catch" -> new Block(null, "try", Map.of(), Map.of("catches", List.of(alone)), null);
            default -> alone;
        };
        String body = BlocksToJava.body(new Block(null, "method", Map.of(), Map.of("body", List.of(stmt)), null),
                BlocksToJava.Style.DEFAULT);
        BodyDeclaration<?> member = onlyMember("class " + V + " { " + V + "() " + body + " }", id);
        if (!(member instanceof ConstructorDeclaration ctor)) throw new InvalidNodeException(id, "текст ноды выходит за её оператор");
        List<Statement> st = ctor.getBody().getStatements();
        if (b.kind().equals("raw")) return; // raw — исходный текст, может быть несколько операторов
        boolean one = st.size() == 1 && switch (b.kind()) {
            case "case" -> st.get(0) instanceof SwitchStmt s && s.getEntries().size() == 1;
            case "catch" -> st.get(0) instanceof TryStmt t && t.getCatchClauses().size() == 1;
            default -> true;
        };
        if (!one) throw new InvalidNodeException(id, "текст ноды выходит за её оператор");
    }

    private void signature(String sig, String id) {
        if (!(onlyMember("class " + V + " { " + sig + " {\n} }", id) instanceof CallableDeclaration<?>)) {
            throw new InvalidNodeException(id, "сигнатура должна объявлять ровно один метод или конструктор");
        }
    }

    private BodyDeclaration<?> onlyMember(String src, String id) {
        ParseResult<CompilationUnit> r = parser.parse(src);
        if (!r.isSuccessful() || r.getResult().isEmpty()) {
            String why = r.getProblems().isEmpty() ? "ошибка разбора" : r.getProblems().get(0).getMessage();
            throw new InvalidNodeException(id, "Синтаксическая ошибка: " + why);
        }
        List<TypeDeclaration<?>> types = r.getResult().get().getTypes();
        if (types.size() != 1 || types.get(0).getMembers().size() != 1) {
            throw new InvalidNodeException(id, "текст ноды выходит за её оператор");
        }
        return types.get(0).getMember(0);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

}
