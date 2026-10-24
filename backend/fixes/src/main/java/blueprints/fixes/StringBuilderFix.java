package blueprints.fixes;

import static blueprints.fixes.FixText.*;

import blueprints.analysis.MethodAnalysis;
import blueprints.analysis.ProjectAnalysis;
import blueprints.analysis.StringConcatInLoop;
import blueprints.analysis.StringConcatInLoop.Concat;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.expr.AssignExpr;
import com.github.javaparser.ast.expr.BinaryExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.SimpleName;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.ast.stmt.BreakStmt;
import com.github.javaparser.ast.stmt.ContinueStmt;
import com.github.javaparser.ast.stmt.ExpressionStmt;
import com.github.javaparser.ast.stmt.Statement;
import com.github.javaparser.ast.stmt.TryStmt;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Фикс §9 для {@code StringConcatInLoop}: {@code s += x} / {@code s = s + a + b} в цикле →
 * {@code StringBuilder sSb = new StringBuilder(s);} перед циклом, {@code sSb.append(x)} в цикле, {@code s = sSb.toString();}
 * сразу после цикла. Остальной текст файла не трогается (правки — только этих диапазонов).
 * <p>
 * target — id находки {@code StringConcatInLoop:methodId:строка:колонка} (строка/колонка — начало цикла).
 * Узкий шаблон, иначе {@code canApply = false}: все переменные цикла — локальные String, объявлены до цикла, не null
 * (инициализатор и присваивания до цикла — литерал или конкатенация); внутри цикла переменная встречается только в
 * своих конкатенациях-операторах (не читается, не в заголовке, не {@code s += s}); цикл — оператор блока на своей строке,
 * без меток и labeled break/continue, не внутри try относительно объявления (исключение/finally не увидят старое значение).
 */
public final class StringBuilderFix implements Refactoring {
    public static final String ID = "string-builder";

    @Override
    public String id() {
        return ID;
    }

    @Override
    public boolean canApply(Map<String, String> files, String target) {
        return rewrite(files, target) != null;
    }

    @Override
    public Map<String, String> apply(Map<String, String> files, String target) {
        Map<String, String> out = rewrite(files, target);
        if (out == null) throw new IllegalArgumentException("фикс " + ID + " неприменим к " + target);
        return out;
    }

    /** Новый текст файла с методом или null, если шаблон не подходит. */
    private static Map<String, String> rewrite(Map<String, String> files, String target) {
        String[] t = target == null ? new String[0] : target.split(":");
        if (t.length < 4) return null;
        int line, col;
        try {
            line = Integer.parseInt(t[t.length - 2]);
            col = Integer.parseInt(t[t.length - 1]);
        } catch (NumberFormatException e) {
            return null;
        }
        MethodAnalysis m = ProjectAnalysis.of(sources(files)).method(String.join(":", Arrays.copyOfRange(t, 1, t.length - 2)));
        if (m == null) return null;
        List<Concat> cs = StringConcatInLoop.concats(m).stream()
                .filter(c -> c.loop().getBegin().filter(b -> b.line == line && b.column == col).isPresent()).toList();
        if (cs.isEmpty()) return null;
        Node loop = cs.get(0).loop();
        String text = files.get(m.file());
        String indent = indent(text, loop);
        if (indent == null || !(loop instanceof Statement) || !(loop.getParentNode().orElse(null) instanceof BlockStmt)
                || loop.findFirst(BreakStmt.class, b -> b.getLabel().isPresent()).isPresent()
                || loop.findFirst(ContinueStmt.class, c -> c.getLabel().isPresent()).isPresent()) return null;

        // переменные по тождеству объявления, в порядке исходника
        List<VariableDeclarator> vars = new ArrayList<>();
        for (Concat c : cs) {
            if (c.declaration() == null || !c.knownString()) return null;
            if (vars.stream().noneMatch(v -> v == c.declaration())) vars.add(c.declaration());
        }
        Set<String> taken = new LinkedHashSet<>();
        m.declaration().findAll(SimpleName.class).forEach(n -> taken.add(n.asString()));
        String nl = newline(text);
        StringBuilder before = new StringBuilder(), after = new StringBuilder();
        List<Edit> edits = new ArrayList<>();
        for (VariableDeclarator vd : vars) {
            String s = vd.getNameAsString();
            List<Concat> mine = cs.stream().filter(c -> c.declaration() == vd).toList();
            if (!safe(m, loop, vd, mine)) return null;
            String sb = s + "Sb";
            for (int i = 2; taken.contains(sb); i++) sb = s + "Sb" + i;
            taken.add(sb);
            before.append("StringBuilder ").append(sb).append(" = new StringBuilder(").append(s).append(");").append(nl).append(indent);
            after.append(nl).append(indent).append(s).append(" = ").append(sb).append(".toString();");
            for (Concat c : mine) {
                StringBuilder call = new StringBuilder(sb);
                for (Expression e : appended(c.at())) call.append(".append(").append(slice(text, e)).append(')');
                edits.add(new Edit(start(text, c.at()), end(text, c.at()), call.toString()));
            }
        }
        edits.add(new Edit(start(text, loop), start(text, loop), before.toString()));
        edits.add(new Edit(end(text, loop), end(text, loop), after.toString()));
        Map<String, String> res = new LinkedHashMap<>();
        res.put(m.file(), applyEdits(text, edits));
        return res;
    }

    private static boolean safe(MethodAnalysis m, Node loop, VariableDeclarator vd, List<Concat> mine) {
        String s = vd.getNameAsString();
        if (vd.isDescendantOf(loop) || !nonNull(vd.getInitializer().orElse(null))) return false;
        // между объявлением и циклом нет try: из catch/finally было бы видно не обновлённое значение
        Node scope = vd.getParentNode().flatMap(Node::getParentNode).orElse(null);
        if (scope instanceof ExpressionStmt es) scope = es.getParentNode().orElse(null);
        for (Node n = loop.getParentNode().orElse(null); n != null && n != scope; n = n.getParentNode().orElse(null)) {
            if (n instanceof TryStmt) return false;
        }
        int allowed = 0;
        for (Concat c : mine) {
            if (!(c.at().getParentNode().orElse(null) instanceof ExpressionStmt)) return false; // значение присваивания используется
            allowed += c.at().getOperator() == AssignExpr.Operator.ASSIGN ? 2 : 1;
            for (Expression e : appended(c.at())) {
                // ponytail: тип char[] виден только у переменных; вызов, возвращающий char[], не распознаётся
                if (e instanceof NameExpr n && String.valueOf(m.typeOf(n.getNameAsString())).endsWith("[]")) return false;
            }
        }
        long uses = loop.findAll(NameExpr.class, n -> n.getNameAsString().equals(s)).size();
        if (uses != allowed) return false;
        // до цикла — только присваивания, дающие не null
        int loopStart = loop.getBegin().map(p -> p.line).orElse(0);
        for (AssignExpr a : m.declaration().findAll(AssignExpr.class)) {
            if (!(a.getTarget() instanceof NameExpr n) || !n.getNameAsString().equals(s)) continue;
            if (a.getBegin().map(p -> p.line).orElse(0) > loopStart || a.isDescendantOf(loop)) continue;
            if (a.getOperator() != AssignExpr.Operator.PLUS
                    && !(a.getOperator() == AssignExpr.Operator.ASSIGN && nonNull(a.getValue()))) return false;
        }
        return true;
    }

    /** Строковый литерал или конкатенация: точно не null. */
    private static boolean nonNull(Expression e) {
        return e instanceof StringLiteralExpr || e instanceof BinaryExpr b && b.getOperator() == BinaryExpr.Operator.PLUS;
    }

    /** {@code s += x} → [x]; {@code s = s + a + b} → [a, b] (цепочка + левоассоциативна, каждое звено — конкатенация строк). */
    private static List<Expression> appended(AssignExpr a) {
        if (a.getOperator() == AssignExpr.Operator.PLUS) return List.of(a.getValue());
        List<Expression> out = new ArrayList<>();
        Expression e = a.getValue();
        while (e instanceof BinaryExpr b && b.getOperator() == BinaryExpr.Operator.PLUS) {
            out.add(0, b.getRight());
            e = b.getLeft();
        }
        return out;
    }
}
