package blueprints.analysis;

import blueprints.model.Issue;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.stmt.DoStmt;
import com.github.javaparser.ast.stmt.WhileStmt;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * §8.3: линейный поиск {@code contains/indexOf/lastIndexOf/remove(obj)} у списка внутри цикла (не константного).
 * Тип получателя — по таблице {@link JdkCosts}: списки сообщаются, Set/Map/String и классы проекта — нет.
 * Неизвестный тип получателя (только contains/indexOf/lastIndexOf), {@code Collection} (может быть Set), нераспознанный
 * (fresh) размер списка, цикл while/do или remove(переменная неизвестного типа) → confidence low. remove с аргументом,
 * который может быть индексом (выражение, литерал, int/short/byte/char), не сообщается.
 */
public final class LinearSearchInLoop implements Detector {
    private static final Set<String> INDEX_TYPES = Set.of("int", "short", "byte", "char");
    private static final Set<String> SEARCH = Set.of("contains", "indexOf", "lastIndexOf");

    @Override
    public String id() {
        return "LinearSearchInLoop";
    }

    @Override
    public List<Issue> detect(MethodAnalysis m, ProjectAnalysis project) {
        List<Issue> out = new ArrayList<>();
        for (MethodCallExpr call : m.declaration().findAll(MethodCallExpr.class)) {
            String name = call.getNameAsString();
            if (call.getScope().isEmpty() || call.getArguments().size() != 1) continue;
            Boolean removeObj = name.equals("remove") ? removeByObject(m, call.getArgument(0)) : Boolean.TRUE;
            if (!SEARCH.contains(name) && (!name.equals("remove") || removeObj == null)) continue;
            BigO loops = BigO.ONE;
            boolean whileLoop = false;
            for (Node l : m.enclosingLoops(call)) {
                loops = loops.times(m.loopSize(l));
                whileLoop |= l instanceof WhileStmt || l instanceof DoStmt;
            }
            if (loops.isConstant()) continue;

            Expression scope = call.getScope().get();
            String type = project.typeOfExpr(scope, m);
            boolean known = type != null;
            if (known && !(JdkCosts.isList(type) && JdkCosts.lookup(type, name, 1) != null)) continue;
            if (!known && !SEARCH.contains(name)) continue;

            BigO n = m.size(scope);
            // нераспознанное (fresh) число итераций не важно: поиск по списку линеен в любом случае (отступление от §8.2);
            // поэтому и fresh-размер списка, выросшего от того же цикла, confidence не понижает
            Set<String> loopSyms = loops.symbols();
            boolean low = whileLoop || !known || !removeObj || JdkCosts.isAbstractCollection(type) || n == null
                    || n.symbols().stream().anyMatch(s -> m.isFresh(s) && !loopSyms.contains(s));
            if (n == null) n = BigO.of(m.id() + "|" + scope);
            BigO before = loops.times(n);
            out.add(Issues.of(id(), "medium", low ? "low" : "high", m, call,
                    "Линейный поиск " + name + "() по списку «" + scope + "» в цикле: " + before,
                    "Собрать до цикла LinkedHashSet (для indexOf — LinkedHashMap значение → индекс) и искать в нём за O(1)",
                    before, loops.plus(n)));
        }
        return out;
    }

    /**
     * remove(arg): TRUE — точно remove(Object) (new …, строка, переменная не целого типа), FALSE — переменная неизвестного
     * типа (low), null — может быть индексом (выражение, литерал, int/short/byte/char), не сообщаем.
     */
    private static Boolean removeByObject(MethodAnalysis m, Expression arg) {
        if (arg instanceof ObjectCreationExpr || arg instanceof StringLiteralExpr) return true;
        if (!(arg instanceof NameExpr ne)) return null;
        String t = m.typeOf(ne.getNameAsString());
        if (t == null) return false;
        return INDEX_TYPES.contains(t) ? null : Boolean.TRUE;
    }
}
