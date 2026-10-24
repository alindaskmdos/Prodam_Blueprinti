package blueprints.analysis;

import blueprints.model.Issue;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.expr.BinaryExpr;
import com.github.javaparser.ast.expr.CastExpr;
import com.github.javaparser.ast.expr.EnclosedExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.FieldAccessExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.expr.ThisExpr;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * §8.3: {@code ==}/{@code !=} на String и обёртках — сравниваются ссылки, а не значения. Оба операнда — String или одна
 * обёртка по объявленному типу, строковый литерал или конкатенация со строкой. Не сообщается: null, примитив/примитивный
 * литерал (анбоксинг), enum и прочие типы, неизвестный тип, {@code this}, два литерала. Тип из {@code var} от вызова метода
 * проекта или из результата метода → confidence low. Span — бинарное выражение, severity high, без complexity и fixes.
 */
public final class ReferenceEquality implements Detector {
    private static final Set<String> BOXED = Set.of("String", "Integer", "Long", "Short", "Byte", "Character", "Boolean",
            "Double", "Float");

    private record Typed(String type, boolean certain, boolean literal) {}

    @Override
    public String id() {
        return "ReferenceEquality";
    }

    @Override
    public List<Issue> detect(MethodAnalysis m, ProjectAnalysis project) {
        List<Issue> out = new ArrayList<>();
        for (BinaryExpr b : m.declaration().findAll(BinaryExpr.class)) {
            boolean eq = b.getOperator() == BinaryExpr.Operator.EQUALS;
            if (!eq && b.getOperator() != BinaryExpr.Operator.NOT_EQUALS) continue;
            Typed l = type(b.getLeft(), m, project), r = type(b.getRight(), m, project);
            if (l == null || r == null || !l.type().equals(r.type()) || !BOXED.contains(l.type()) || l.literal() && r.literal()) {
                continue;
            }
            String a = b.getLeft().toString(), c = b.getRight().toString();
            String fixed = (eq ? "" : "!") + "Objects.equals(" + a + ", " + c + ")";
            out.add(Issues.of(id(), "high", l.certain() && r.certain() ? "high" : "low", m, b,
                    "Сравнение ссылок " + b + " для " + l.type() + ": " + (eq ? "==" : "!=")
                            + " сравнивает объекты, а не значения — равные значения могут оказаться «разными»",
                    "Сравнивать значения через equals: Objects.equals(a, b) (безопасно к null) или a.equals(b). "
                            + "Было: " + b + " → стало: " + fixed,
                    null, null));
        }
        return out;
    }

    private static Typed type(Expression e, MethodAnalysis m, ProjectAnalysis project) {
        if (e instanceof EnclosedExpr x) return type(x.getInner(), m, project);
        if (e instanceof StringLiteralExpr) return new Typed("String", true, true);
        if (e instanceof CastExpr x) return new Typed(MethodAnalysis.simpleType(x.getType()), true, false);
        if (e instanceof BinaryExpr x && x.getOperator() == BinaryExpr.Operator.PLUS) {
            Typed l = type(x.getLeft(), m, project), r = type(x.getRight(), m, project);
            boolean str = l != null && l.type().equals("String") || r != null && r.type().equals("String");
            return str ? new Typed("String", true, (l == null || l.literal()) && (r == null || r.literal())) : null;
        }
        if (e instanceof NameExpr x) return name(x.getNameAsString(), m, project);
        if (e instanceof FieldAccessExpr x && x.getScope() instanceof ThisExpr) return name(x.getNameAsString(), m, project);
        if (e instanceof MethodCallExpr x) {
            String t = project.typeOfExpr(x, m);
            return t == null ? null : new Typed(t, false, false);
        }
        return null;
    }

    private static Typed name(String name, MethodAnalysis m, ProjectAnalysis project) {
        String t = m.unambiguousTypeOf(name);
        if (t != null) return new Typed(t, true, false);
        if (m.typeOf(name) != null) return null; // параметр лямбды без типа или разные объявления — тип неизвестен
        long decls = m.declaration().findAll(VariableDeclarator.class).stream().filter(v -> v.getNameAsString().equals(name)).count()
                + m.declaration().findAll(com.github.javaparser.ast.body.Parameter.class).stream()
                        .filter(p -> p.getNameAsString().equals(name)).count();
        if (decls != 1) return null;
        // var: тип по инициализатору (литерал, конкатенация — уверенно; вызов метода проекта — неуверенно)
        for (VariableDeclarator v : m.declaration().findAll(VariableDeclarator.class)) {
            if (v.getNameAsString().equals(name) && v.getType().isVarType() && v.getInitializer().isPresent()) {
                Typed it = type(v.getInitializer().get(), m, project);
                return it == null ? null : new Typed(it.type(), it.certain(), false);
            }
        }
        return null;
    }
}
