package blueprints.analysis;

import blueprints.model.Issue;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.expr.AssignExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.UnaryExpr;
import com.github.javaparser.ast.stmt.DoStmt;
import com.github.javaparser.ast.stmt.WhileStmt;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * §8.3: вложенные циклы по одному символу размера (O(n·n)). Символы квалифицированы, поэтому одноимённые
 * коллекции разных классов/методов не совпадают. Одна проблема на внутренний цикл — с ближайшим внешним
 * по тому же символу; span — внутренний цикл. while/do — confidence low (размер неточен).
 */
public final class NestedLoopSameCollection implements Detector {
    @Override
    public String id() {
        return "NestedLoopSameCollection";
    }

    @Override
    public List<Issue> detect(MethodAnalysis m, ProjectAnalysis project) {
        List<Issue> out = new ArrayList<>();
        for (Node inner : m.declaration().findAll(Node.class, n -> m.loopSize(n) != null)) {
            BigO in = m.loopSize(inner);
            List<Node> outers = m.enclosingLoops(inner);
            for (int i = outers.size() - 1; i >= 0; i--) {
                Node outer = outers.get(i);
                BigO o = m.loopSize(outer);
                Set<String> same = new LinkedHashSet<>(o.symbols());
                same.retainAll(in.symbols());
                if (same.isEmpty()) continue;
                if (sharedCursor(outer, inner)) break;
                BigO before = o.times(in);
                boolean low = isWhile(inner) || isWhile(outer) || same.stream().anyMatch(m::isFresh);
                out.add(Issues.of(id(), "high", low ? "low" : "high", m, inner,
                        "Вложенные циклы по одной коллекции «" + Issues.shortName(same.iterator().next()) + "»: " + before,
                        "Построить до цикла индекс по ключу (LinkedHashMap) и искать в нём вместо внутреннего цикла",
                        before, o.plus(in)));
                break;
            }
        }
        return out;
    }

    private static boolean isWhile(Node n) {
        return n instanceof WhileStmt || n instanceof DoStmt;
    }

    /**
     * Внутренний while двигает переменную из условия внешнего while (токенизатор {@code while (i < n) while (i < n && …) i++})
     * — общий курсор, на деле O(n).
     */
    private static boolean sharedCursor(Node outer, Node inner) {
        Set<String> vars = condVars(outer);
        if (vars.isEmpty()) return false;
        vars.retainAll(condVars(inner));
        if (vars.isEmpty()) return false;
        Node body = inner instanceof WhileStmt w ? w.getBody() : ((DoStmt) inner).getBody();
        return body.findAll(Expression.class).stream().anyMatch(e -> switch (e) {
            case UnaryExpr u when u.getExpression() instanceof NameExpr n -> vars.contains(n.getNameAsString());
            case AssignExpr a when a.getTarget() instanceof NameExpr n -> vars.contains(n.getNameAsString());
            default -> false;
        });
    }

    private static Set<String> condVars(Node loop) {
        Expression c = loop instanceof WhileStmt w ? w.getCondition() : loop instanceof DoStmt d ? d.getCondition() : null;
        Set<String> out = new LinkedHashSet<>();
        if (c != null) c.findAll(NameExpr.class).forEach(n -> out.add(n.getNameAsString()));
        return out;
    }
}
