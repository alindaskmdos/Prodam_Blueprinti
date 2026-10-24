package blueprints.analysis;

import blueprints.model.Issue;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.expr.EnclosedExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.FieldAccessExpr;
import com.github.javaparser.ast.expr.LambdaExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.expr.SwitchExpr;
import com.github.javaparser.ast.expr.TextBlockLiteralExpr;
import com.github.javaparser.ast.expr.ThisExpr;
import com.github.javaparser.ast.stmt.ExpressionStmt;
import com.github.javaparser.ast.stmt.SwitchEntry;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * §8.3: результат вызова у неизменяемого типа отброшен ({@code s.trim();}, {@code total.add(x);}, {@code d.plusDays(1);}) —
 * вызов возвращает новое значение, получатель не меняется. Тип получателя — объявленный тип переменной/поля, литерал, {@code new}
 * или такой же вызов в цепочке; неизвестный тип не сообщается. Span — вызов, severity high, confidence high, без complexity и fixes.
 */
public final class IgnoredResult implements Detector {
    private static final Set<String> BIG_COMMON = Set.of("add", "subtract", "multiply", "divide", "negate", "abs", "pow",
            "remainder", "max", "min", "sqrt");
    private static final Map<String, Set<String>> PURE = Map.of(
            "String", Set.of("trim", "strip", "stripLeading", "stripTrailing", "stripIndent", "toUpperCase", "toLowerCase",
                    "replace", "replaceAll", "replaceFirst", "substring", "concat", "repeat", "formatted", "intern", "indent",
                    "translateEscapes"),
            "BigDecimal", union(BIG_COMMON, Set.of("setScale", "round", "plus", "movePointLeft", "movePointRight",
                    "scaleByPowerOfTen", "stripTrailingZeros")),
            "BigInteger", union(BIG_COMMON, Set.of("mod", "modPow", "modInverse", "gcd", "shiftLeft", "shiftRight", "and",
                    "or", "xor", "not", "andNot", "setBit", "clearBit", "flipBit")));
    /** java.time: plus*, minus*, with* и перечисленные. */
    private static final Set<String> TIME = Set.of("LocalDate", "LocalDateTime", "LocalTime", "Instant", "Duration",
            "ZonedDateTime", "OffsetDateTime", "Period", "Year", "YearMonth");
    private static final Set<String> TIME_OTHER = Set.of("truncatedTo", "negated", "abs", "multipliedBy", "normalized");

    @Override
    public String id() {
        return "IgnoredResult";
    }

    @Override
    public List<Issue> detect(MethodAnalysis m, ProjectAnalysis project) {
        List<Issue> out = new ArrayList<>();
        for (ExpressionStmt st : m.declaration().findAll(ExpressionStmt.class)) {
            if (!(st.getExpression() instanceof MethodCallExpr call) || valueContext(st)) continue;
            String type = resultType(call, m);
            if (type != null && project.isProjectType(type)) continue; // свой класс с тем же именем
            if (type == null) continue;
            Expression root = root(call);
            String var = root instanceof NameExpr || root instanceof FieldAccessExpr ? root.toString() : null;
            String text = call.toString();
            String after = var != null ? var + " = " + text + ";" : type + " result = " + text + ";";
            out.add(Issues.of(id(), "high", "high", m, call,
                    "Результат " + text + " не используется — " + type + " неизменяем"
                            + (var != null ? ", " + var + " не меняется" : ", вызов ничего не делает"),
                    "Присвоить или использовать результат. Было: " + text + "; → стало: " + after, null, null));
        }
        return out;
    }

    /** Тип результата чистого вызова у известного неизменяемого типа или null. */
    private static String resultType(MethodCallExpr call, MethodAnalysis m) {
        if (call.getScope().isEmpty()) return null;
        String recv = typeOf(call.getScope().get(), m);
        if (recv == null) return null;
        String name = call.getNameAsString();
        if (TIME.contains(recv)) {
            boolean pure = name.startsWith("plus") || name.startsWith("minus") || name.startsWith("with") || TIME_OTHER.contains(name);
            return pure ? recv : null;
        }
        Set<String> pure = PURE.get(recv);
        return pure != null && pure.contains(name) ? recv : null;
    }

    private static String typeOf(Expression e, MethodAnalysis m) {
        if (e instanceof EnclosedExpr x) return typeOf(x.getInner(), m);
        if (e instanceof StringLiteralExpr || e instanceof TextBlockLiteralExpr) return "String";
        if (e instanceof ObjectCreationExpr x) return x.getType().getNameAsString();
        if (e instanceof NameExpr x) return m.unambiguousTypeOf(x.getNameAsString());
        if (e instanceof FieldAccessExpr x && x.getScope() instanceof ThisExpr) return m.unambiguousTypeOf(x.getNameAsString());
        if (e instanceof MethodCallExpr x) return resultType(x, m);
        return null;
    }

    /** Оператор — значение: тело лямбды-выражения или ветка {@code case X -> expr;} switch-выражения. */
    private static boolean valueContext(ExpressionStmt st) {
        Node parent = st.getParentNode().orElse(null);
        return parent instanceof LambdaExpr
                || parent instanceof SwitchEntry e && e.getParentNode().orElse(null) instanceof SwitchExpr;
    }

    private static Expression root(MethodCallExpr call) {
        Expression e = call;
        while (true) {
            if (e instanceof MethodCallExpr c && c.getScope().isPresent()) e = c.getScope().get();
            else if (e instanceof EnclosedExpr x) e = x.getInner();
            else return e;
        }
    }

    private static Set<String> union(Set<String> a, Set<String> b) {
        Set<String> s = new java.util.LinkedHashSet<>(a);
        s.addAll(b);
        return Set.copyOf(s);
    }
}
