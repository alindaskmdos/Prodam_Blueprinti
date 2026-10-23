package blueprints.blocks;

import blueprints.model.Block;
import blueprints.model.Span;
import com.github.javaparser.JavaToken;
import com.github.javaparser.Position;
import com.github.javaparser.Range;
import com.github.javaparser.TokenRange;
import com.github.javaparser.ast.Modifier;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.NodeList;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.comments.Comment;
import com.github.javaparser.ast.expr.AnnotationExpr;
import com.github.javaparser.ast.expr.AssignExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.SimpleName;
import com.github.javaparser.ast.expr.VariableDeclarationExpr;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.ast.stmt.BreakStmt;
import com.github.javaparser.ast.stmt.CatchClause;
import com.github.javaparser.ast.stmt.ContinueStmt;
import com.github.javaparser.ast.stmt.DoStmt;
import com.github.javaparser.ast.stmt.ExpressionStmt;
import com.github.javaparser.ast.stmt.ForEachStmt;
import com.github.javaparser.ast.stmt.ForStmt;
import com.github.javaparser.ast.stmt.IfStmt;
import com.github.javaparser.ast.stmt.ReturnStmt;
import com.github.javaparser.ast.stmt.Statement;
import com.github.javaparser.ast.stmt.SwitchEntry;
import com.github.javaparser.ast.stmt.SwitchStmt;
import com.github.javaparser.ast.stmt.ThrowStmt;
import com.github.javaparser.ast.stmt.TryStmt;
import com.github.javaparser.ast.stmt.WhileStmt;
import com.github.javaparser.ast.type.Type;
import com.github.javaparser.printer.DefaultPrettyPrinter;
import com.github.javaparser.printer.configuration.DefaultConfigurationOption;
import com.github.javaparser.printer.configuration.DefaultPrinterConfiguration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;

/**
 * Метод/конструктор JavaParser -> дерево {@link Block} (§4-§5 ТЗ, контракт Block).
 * Неподдержанный оператор -> {@code raw} с исходным текстом, исключений наружу не бросает.
 * Тексты выражений — точный исходник (TokenRange) вместе с комментариями внутри; прочие комментарии
 * раскладываются блоками по позиции (правила — README модуля).
 */
public final class AstToBlocks {

    private final String file;
    /** Все комментарии тела метода по позиции. */
    private final List<Comment> pool;
    /** Уже попавшие в дерево: блоком comment, в текст выражения или в raw. */
    private final Set<Comment> handled = Collections.newSetFromMap(new IdentityHashMap<>());
    /** Ставшие блоками comment, в порядке дерева. */
    private final List<Comment> emitted = new ArrayList<>();

    private AstToBlocks(String file, List<Comment> pool) {
        this.file = file;
        this.pool = pool;
    }

    /**
     * @param decl     метод или конструктор из разобранного исходника (нужны позиции и токены)
     * @param methodId id формата {@code Class.method~N}; от него строятся id блоков
     * @param file     путь файла для span (как в проекте)
     */
    public static Block convert(CallableDeclaration<?> decl, String methodId, String file) {
        BlockStmt body = decl instanceof MethodDeclaration m ? m.getBody().orElse(null)
                : ((ConstructorDeclaration) decl).getBody();
        List<Comment> pool = body == null ? List.of() : comments(body);
        AstToBlocks c = new AstToBlocks(file, pool);
        List<Block> blocks = body == null ? List.of() : c.seq(body.getStatements(), range(body));
        Block root = new Block(null, "method", f("signature", signature(decl, body)), slots("body", blocks), c.span(decl));
        return assignIds(root, methodId);
    }

    /** Комментарии тела, которые {@link #convert} делает блоками comment (без попавших в текст выражений и raw). */
    static List<Comment> blockComments(CallableDeclaration<?> decl) {
        BlockStmt body = decl instanceof MethodDeclaration m ? m.getBody().orElse(null)
                : ((ConstructorDeclaration) decl).getBody();
        if (body == null) return List.of();
        AstToBlocks c = new AstToBlocks("", comments(body));
        c.seq(body.getStatements(), range(body));
        return c.emitted;
    }

    /**
     * Комментарии тела по позиции, каждый один раз: JavaParser может вернуть один комментарий
     * несколько раз (например, {@code foo(x, z // c\n)}).
     */
    private static List<Comment> comments(BlockStmt body) {
        Map<Position, Comment> byBegin = new TreeMap<>();
        for (Comment c : body.getAllContainedComments()) {
            c.getRange().ifPresent(r -> byBegin.putIfAbsent(r.begin, c));
        }
        return List.copyOf(byBegin.values());
    }

    /** Пересчитывает id всего поддерева: {@code <id>/<slot>/<i>/...}. */
    private static Block assignIds(Block b, String id) {
        Map<String, List<Block>> slots = new LinkedHashMap<>();
        b.slots().forEach((name, list) -> {
            List<Block> out = new ArrayList<>();
            for (Block child : list) out.add(assignIds(child, id + "/" + name + "/" + out.size()));
            slots.put(name, out);
        });
        return new Block(id, b.kind(), b.fields(), slots, b.span(), b.issues(), b.collapsed());
    }

    /** Точный исходный текст заголовка до тела (аннотации, модификаторы, типовые параметры, throws). */
    private static String signature(CallableDeclaration<?> decl, BlockStmt body) {
        TokenRange r = decl.getTokenRange().orElseThrow(() -> new IllegalArgumentException("нужен разобранный исходник"));
        JavaToken last = body != null ? body.getTokenRange().orElseThrow().getBegin() : r.getEnd();
        return new TokenRange(r.getBegin(), last.getPreviousToken().orElseThrow()).toString().strip();
    }

    // ---- последовательности и комментарии ----

    /**
     * Слот: элементы (операторы, case, catch) и свободные комментарии внутри region по позиции.
     * Комментарий внутри элемента, который сам элемент не разместил (заголовок if/for/catch, имя переменной),
     * ставится блоком прямо перед элементом.
     */
    private List<Block> seq(List<? extends Node> items, Range region) {
        List<Node> order = new ArrayList<>(items);
        for (Comment c : pool) {
            if (!handled.contains(c) && region.contains(range(c))
                    && items.stream().noneMatch(n -> range(n).contains(range(c)))) {
                order.add(c);
            }
        }
        order.sort(Comparator.comparing(n -> range(n).begin));
        List<Block> out = new ArrayList<>();
        for (Node n : order) {
            if (n instanceof Comment c) {
                out.add(comment(c));
                continue;
            }
            Block b = item(n);
            for (Comment c : pool) {
                if (!handled.contains(c) && range(n).contains(range(c))) out.add(comment(c));
            }
            out.add(b);
        }
        return out;
    }

    private Block comment(Comment c) {
        handled.add(c);
        emitted.add(c);
        return leaf("comment", f("text", c.getContent().strip()), c);
    }

    private Block item(Node n) {
        if (n instanceof SwitchEntry e) return caseBlock(e);
        if (n instanceof CatchClause c) return catchBlock(c);
        return stmt((Statement) n);
    }

    /** then/else/body: блок раскрывается в список, одиночный оператор — список из одного. */
    private List<Block> slot(Statement s) {
        if (s instanceof BlockStmt b) return seq(b.getStatements(), range(b));
        return seq(List.of(s), range(s));
    }

    // ---- операторы ----

    private Block stmt(Statement s) {
        try {
            Block b = convertStmt(s);
            return b != null ? b : raw(s);
        } catch (RuntimeException e) {
            return raw(s);
        }
    }

    private Block convertStmt(Statement s) {
        if (s instanceof ExpressionStmt es) {
            Expression e = es.getExpression();
            if (es.getParentNode().orElse(null) instanceof SwitchEntry se && se.getType() == SwitchEntry.Type.EXPRESSION) {
                return leaf("expr", f("text", text(e)), s); // case X -> expr;
            }
            if (e instanceof VariableDeclarationExpr v) {
                if (v.getVariables().size() != 1) return null;
                VariableDeclarator d = v.getVariable(0);
                Map<String, String> f = f("type", typeText(v.getModifiers(), v.getAnnotations(), d.getType()),
                        "name", d.getNameAsString());
                d.getInitializer().ifPresent(i -> f.put("init", text(i)));
                return leaf("var", f, s);
            }
            if (e instanceof AssignExpr a) {
                return leaf("assign", f("target", text(a.getTarget()), "op", a.getOperator().asString(),
                        "value", text(a.getValue())), s);
            }
            return leaf("expr", f("text", text(e)), s);
        }
        if (s instanceof IfStmt i) {
            Map<String, String> f = f("cond", text(i.getCondition()));
            Map<String, List<Block>> slots = slots("then", slot(i.getThenStmt()));
            slots.put("else", i.getElseStmt().map(this::slot).orElse(List.of()));
            return new Block(null, "if", f, slots, span(s));
        }
        if (s instanceof WhileStmt w) return loop("while", f("cond", text(w.getCondition())), w.getBody(), s);
        if (s instanceof DoStmt d) return loop("dowhile", f("cond", text(d.getCondition())), d.getBody(), s);
        if (s instanceof ForStmt fs) {
            return loop("for", f("init", text(fs.getInitialization()),
                    "cond", fs.getCompare().map(this::text).orElse(""),
                    "update", text(fs.getUpdate())), fs.getBody(), s);
        }
        if (s instanceof ForEachStmt fe) {
            VariableDeclarationExpr v = fe.getVariable();
            return loop("foreach", f("type", typeText(v.getModifiers(), v.getAnnotations(), v.getVariable(0).getType()),
                    "var", v.getVariable(0).getNameAsString(), "iterable", text(fe.getIterable())), fe.getBody(), s);
        }
        if (s instanceof SwitchStmt sw) {
            Map<String, String> f = f("selector", text(sw.getSelector()));
            return new Block(null, "switch", f, slots("cases", seq(sw.getEntries(), range(sw))), span(sw));
        }
        if (s instanceof TryStmt t) return tryStmt(t);
        if (s instanceof ReturnStmt r) {
            Map<String, String> f = f();
            r.getExpression().ifPresent(e -> f.put("value", text(e)));
            return leaf("return", f, s);
        }
        if (s instanceof ThrowStmt t) return leaf("throw", f("value", text(t.getExpression())), s);
        if (s instanceof BreakStmt b) return leaf("break", label(b.getLabel()), s);
        if (s instanceof ContinueStmt c) return leaf("continue", label(c.getLabel()), s);
        return null;
    }

    /** case: метка как в коде; arrow="true" для {@code ->}; тело стрелки-блока раскрывается в операторы. */
    private Block caseBlock(SwitchEntry e) {
        String label = text(e.getLabels());
        if (e.isDefault()) label = label.isEmpty() ? "default" : label + ", default";
        if (e.getGuard().isPresent()) label += " when " + text(e.getGuard().get());
        Map<String, String> f = f("label", label);
        if (e.getType() != SwitchEntry.Type.STATEMENT_GROUP) f.put("arrow", "true");
        List<Statement> stmts = e.getType() == SwitchEntry.Type.BLOCK
                ? ((BlockStmt) e.getStatement(0)).getStatements() : e.getStatements();
        return new Block(null, "case", f, slots("body", seq(stmts, range(e))), span(e));
    }

    /** Слот catches охватывает всё от конца тела try до finally: комментарии перед catch и перед finally. */
    private Block tryStmt(TryStmt t) {
        Map<String, String> f = f();
        if (!t.getResources().isEmpty()) {
            f.put("resources", text(t.getResources()));
        }
        BlockStmt tb = t.getTryBlock();
        Range catchesRegion = new Range(range(tb).end,
                t.getFinallyBlock().map(b -> range(b).begin).orElse(range(t).end));
        Map<String, List<Block>> slots = slots("body", seq(tb.getStatements(), range(tb)));
        slots.put("catches", seq(t.getCatchClauses(), catchesRegion));
        slots.put("finally", t.getFinallyBlock().map(b -> seq(b.getStatements(), range(b))).orElse(List.of()));
        return new Block(null, "try", f, slots, span(t));
    }

    private Block catchBlock(CatchClause c) {
        Parameter p = c.getParameter();
        Map<String, String> f = f("type", typeText(p.getModifiers(), p.getAnnotations(), p.getType()),
                "var", p.getNameAsString());
        return new Block(null, "catch", f, slots("body", seq(c.getBody().getStatements(), range(c.getBody()))), span(c));
    }

    private Block loop(String kind, Map<String, String> fields, Statement body, Statement s) {
        return new Block(null, kind, fields, slots("body", slot(body)), span(s));
    }

    private Block leaf(String kind, Map<String, String> fields, Node n) {
        return new Block(null, kind, fields, Map.of(), span(n));
    }

    /** Исходный текст как есть, вместе с комментариями внутри. */
    private Block raw(Node n) {
        for (Comment c : pool) if (range(n).contains(range(c))) handled.add(c);
        String text = n.getTokenRange().map(TokenRange::toString).orElseGet(n::toString);
        return leaf("raw", f("text", text), n);
    }

    // ---- текст ----

    /** Исходный текст узла как есть (с комментариями внутри). */
    private String text(Node n) {
        return text(n, n);
    }

    /** Исходный текст от начала first до конца last; комментарии внутри считаются размещёнными. */
    private String text(Node first, Node last) {
        Range r = new Range(range(first).begin, range(last).end);
        for (Comment c : pool) if (r.contains(range(c))) handled.add(c);
        return new TokenRange(first.getTokenRange().orElseThrow().getBegin(),
                last.getTokenRange().orElseThrow().getEnd()).toString();
    }

    /** Список узлов одним куском исходника: "int i = 0, j = 1", "i++, j++", "1, 2"; пустой — "". */
    private String text(List<? extends Node> nodes) {
        return nodes.isEmpty() ? "" : text(nodes.get(0), nodes.get(nodes.size() - 1));
    }

    /**
     * Аннотации и модификаторы — префиксом к типу: "final int", "@A final var".
     * Тип печатается без комментариев: у {@code int a[]} он не совпадает с куском исходника,
     * а комментарии внутри типа уходят блоком перед оператором.
     */
    private String typeText(NodeList<Modifier> mods, NodeList<AnnotationExpr> anns, Type t) {
        StringBuilder sb = new StringBuilder();
        for (AnnotationExpr a : anns) sb.append(text(a)).append(' ');
        for (Modifier m : mods) sb.append(m.getKeyword().asString()).append(' ');
        return sb.append(TYPE_PRINTER.print(t)).toString();
    }

    private static final DefaultPrettyPrinter TYPE_PRINTER = new DefaultPrettyPrinter(new DefaultPrinterConfiguration()
            .removeOption(new DefaultConfigurationOption(DefaultPrinterConfiguration.ConfigOption.PRINT_COMMENTS)));

    private Span span(Node n) {
        return n.getRange().map(r -> new Span(file, r.begin.line, r.end.line)).orElse(null);
    }

    private static Range range(Node n) {
        return n.getRange().orElseThrow();
    }

    private static Map<String, String> f(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    private static Map<String, String> label(Optional<SimpleName> l) {
        Map<String, String> m = f();
        l.ifPresent(v -> m.put("label", v.asString()));
        return m;
    }

    private static Map<String, List<Block>> slots(String name, List<Block> blocks) {
        Map<String, List<Block>> m = new LinkedHashMap<>();
        m.put(name, blocks);
        return m;
    }
}
