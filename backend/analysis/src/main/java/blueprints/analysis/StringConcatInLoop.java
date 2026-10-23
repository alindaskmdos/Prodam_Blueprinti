package blueprints.analysis;

import blueprints.model.Issue;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.expr.AssignExpr;
import com.github.javaparser.ast.expr.BinaryExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.stmt.ExpressionStmt;
import com.github.javaparser.ast.stmt.ForStmt;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;

/**
 * §8.3: {@code s += x} / {@code s = s + x} для переменной типа String в цикле не константного размера.
 * Считаются только циклы, которые строка переживает (объявлена вне их или в init этого for). Одна находка на внешний
 * такой цикл (все переменные — в message); span — этот цикл. Неизвестный тип хоть одной переменной → low;
 * известный не String (int += …) — не сообщается. Prepend {@code s = x + s} не сообщается.
 * Поиск — {@link #concats(MethodAnalysis)}, им же пользуется фикс StringBuilder.
 */
public final class StringConcatInLoop implements Detector {
    /**
     * Конкатенация строки в цикле: присваивание, имя переменной, её локальное объявление (null — поле/параметр),
     * внешний цикл, который строка переживает, число итераций переживаемых циклов, тип известен как String.
     */
    public record Concat(AssignExpr at, String variable, VariableDeclarator declaration, Node loop, BigO iterations,
                         boolean knownString) {
    }

    @Override
    public String id() {
        return "StringConcatInLoop";
    }

    /** Все конкатенации строк в циклах метода по порядку исходника (правила детектора; фикс фильтрует по span цикла). */
    public static List<Concat> concats(MethodAnalysis m) {
        List<Concat> out = new ArrayList<>();
        for (AssignExpr a : m.declaration().findAll(AssignExpr.class)) {
            if (!(a.getTarget() instanceof NameExpr t) || !appends(a, t.getNameAsString())) continue;
            String name = t.getNameAsString();
            VariableDeclarator vd = localDeclaration(m, a, name);
            String type = typeOf(m, vd, name);
            if (type != null && !type.equals("String")) continue;
            List<Node> loops = new ArrayList<>();
            for (Node l : m.enclosingLoops(a)) if (outlives(vd, l)) loops.add(l);
            if (loops.isEmpty()) continue;
            BigO n = BigO.ONE;
            for (Node l : loops) n = n.times(m.loopSize(l));
            if (n.isConstant()) continue;
            out.add(new Concat(a, name, vd, loops.get(0), n, type != null));
        }
        return out;
    }

    @Override
    public List<Issue> detect(MethodAnalysis m, ProjectAnalysis project) {
        // группировка по тождеству узлов: Node.equals в JavaParser структурный, одинаковые циклы/объявления слились бы
        List<List<Concat>> byLoop = new ArrayList<>();
        for (Concat c : concats(m)) {
            List<Concat> g = byLoop.stream().filter(x -> x.get(0).loop() == c.loop()).findFirst().orElse(null);
            if (g == null) byLoop.add(g = new ArrayList<>());
            g.add(c);
        }
        List<Issue> out = new ArrayList<>();
        for (List<Concat> cs : byLoop) {
            BigO n = cs.get(0).iterations();
            Set<Object> keys = Collections.newSetFromMap(new IdentityHashMap<>());
            List<String> names = new ArrayList<>();
            boolean low = false;
            for (Concat c : cs) {
                n = n.plus(c.iterations());
                low |= !c.knownString();
                if (keys.add(c.declaration() != null ? c.declaration() : c.variable().intern())) names.add("«" + c.variable() + "»");
            }
            out.add(Issues.of(id(), "medium", low ? "low" : "high", m, cs.get(0).loop(),
                    "Конкатенация строк " + String.join(", ", names) + " в цикле: каждая итерация копирует всю строку, " + n.times(n),
                    "Собирать строку в StringBuilder (append в цикле, toString после цикла)", n.times(n), n));
        }
        return out;
    }

    /** Строка переживает итерацию цикла: объявлена вне его или в init этого for. */
    private static boolean outlives(VariableDeclarator vd, Node loop) {
        if (vd == null || !vd.isDescendantOf(loop)) return true;
        return loop instanceof ForStmt f && f.getInitialization().stream().anyMatch(vd::isDescendantOf);
    }

    /** {@code s += …} или {@code s = s + …} (s — крайний левый операнд цепочки +). */
    private static boolean appends(AssignExpr a, String name) {
        if (a.getOperator() == AssignExpr.Operator.PLUS) return true;
        if (a.getOperator() != AssignExpr.Operator.ASSIGN) return false;
        Expression e = a.getValue();
        while (e instanceof BinaryExpr b && b.getOperator() == BinaryExpr.Operator.PLUS) e = b.getLeft();
        return e != a.getValue() && e instanceof NameExpr n && n.getNameAsString().equals(name);
    }

    /** Локальная переменная (в т.ч. for/for-each), в области видимости которой стоит присваивание, или null (поле/параметр). */
    private static VariableDeclarator localDeclaration(MethodAnalysis m, Node at, String name) {
        for (VariableDeclarator vd : m.declaration().findAll(VariableDeclarator.class)) {
            if (!vd.getNameAsString().equals(name)) continue;
            Node scope = vd.getParentNode().flatMap(Node::getParentNode).orElse(null);
            if (scope instanceof ExpressionStmt s) scope = s.getParentNode().orElse(null);
            if (scope != null && at.isDescendantOf(scope)) return vd;
        }
        return null;
    }

    private static String typeOf(MethodAnalysis m, VariableDeclarator vd, String name) {
        if (vd == null) return m.typeOf(name);
        if (!vd.getType().isVarType()) return MethodAnalysis.simpleType(vd.getType());
        // var: только по инициализатору — typeOf(name) общий для одноимённых локальных разных областей
        return vd.getInitializer().map(i -> i instanceof StringLiteralExpr ? "String"
                : i instanceof ObjectCreationExpr oc ? oc.getType().getNameAsString() : null).orElse(null);
    }
}
