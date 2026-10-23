package blueprints.analysis;

import blueprints.model.Issue;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.stmt.DoStmt;
import com.github.javaparser.ast.stmt.ForEachStmt;
import com.github.javaparser.ast.stmt.ForStmt;
import com.github.javaparser.ast.stmt.WhileStmt;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * §8.3 «N+1»: вызов со стоимостью ≥ O(n) ({@link MethodAnalysis#callCost}: метод проекта по графу или JDK по таблице)
 * внутри цикла не константного размера. Не сообщается:
 * <ul>
 * <li>линейный поиск у списка ({@code contains/indexOf/lastIndexOf/remove} с одним аргументом) — это {@link LinearSearchInLoop};</li>
 * <li>все символы стоимости «дешёвые» — данные самого элемента for-each (получатель {@code o.totalQty()} или аргумент
 * {@code checkLines(o)}: в сумме один проход), если между циклом элемента и вызовом нет других неконстантных циклов;
 * длины строк / целые параметры (ширина, счётчик) — по типу переменной или параметра вызываемого метода.</li>
 * </ul>
 * Fresh-символ (нераспознанный размер, §8.2) или неточная оценка вызываемого метода проекта → confidence low;
 * нераспознанное число итераций цикла confidence не понижает.
 */
public final class ExpensiveCallInLoop implements Detector {
    private static final Set<String> LIST_SEARCH = Set.of("contains", "indexOf", "lastIndexOf", "remove");
    /** Типы, размер которых — длина строки или значение числа, а не коллекция. */
    private static final Set<String> SCALAR = Set.of("String", "CharSequence", "StringBuilder", "StringBuffer",
            "int", "long", "short", "byte", "char", "Integer", "Long", "Short", "Byte", "Character");

    @Override
    public String id() {
        return "ExpensiveCallInLoop";
    }

    @Override
    public List<Issue> detect(MethodAnalysis m, ProjectAnalysis project) {
        List<Issue> out = new ArrayList<>();
        for (Expression call : m.declaration().findAll(Expression.class,
                e -> e instanceof MethodCallExpr || e instanceof ObjectCreationExpr)) {
            BigO cost = m.callCost(call);
            if (cost == null || !cost.isAtLeastLinear()) continue;
            String target = m.callTarget(call);
            if (target == null && linearSearch(call, m, project)) continue;
            List<Node> enclosing = m.enclosingLoops(call);
            BigO loops = BigO.ONE;
            for (Node l : enclosing) loops = loops.times(m.loopSize(l));
            if (loops.isConstant()) continue;

            // элемент — «свои данные», только если его цикл не повторяется внутренним неконстантным циклом
            Set<String> elems = new LinkedHashSet<>();
            for (int i = enclosing.size() - 1; i >= 0; i--) {
                Node l = enclosing.get(i);
                if (l instanceof ForEachStmt fe) fe.getVariable().getVariables().forEach(v -> elems.add(v.getNameAsString()));
                if (!m.loopSize(l).isConstant()) break;
            }
            String recvType = call instanceof MethodCallExpr mc && mc.getScope().orElse(null) instanceof NameExpr r
                    && elems.contains(r.getNameAsString()) ? m.typeOf(r.getNameAsString()) : null;
            if (cost.symbols().stream().allMatch(s -> cheap(s, m, project, elems, recvType, call, target))) continue;

            MethodAnalysis callee = target == null ? null : project.method(target);
            boolean low = cost.symbols().stream().anyMatch(s -> fresh(s, project))
                    || callee != null && !"high".equals(callee.confidence());
            String name = call instanceof MethodCallExpr mc ? mc.getNameAsString() + "()"
                    : "new " + ((ObjectCreationExpr) call).getType().getNameAsString() + "()";
            BigO before = loops.times(cost);
            out.add(Issues.of(id(), "medium", low ? "low" : "high", m, call,
                    "Вызов " + name + " стоимостью " + cost + " в цикле: " + before,
                    "Вынести вызов до цикла или кешировать результат (LinkedHashMap по аргументу)",
                    before, loops.plus(cost)));
        }
        return out;
    }

    /**
     * Символ не даёт N+1:
     * <ul>
     * <li>данные элемента for-each: свой символ {@code methodId|o…}, нестатическое поле класса получателя-элемента,
     * символ вызываемого от параметра, в который передан элемент ({@code sumOf(b)} → {@code sumOf|b.items});</li>
     * <li>длина строки / число: переменная скалярного типа, аргумент скалярного параметра вызываемого
     * ({@code padLeft(String.valueOf(id), 4)}), нераспознанный символ вызываемого от его скалярного параметра или счётного
     * while/do/for без коллекции в условии ({@code do {…} while (true)}). For-each по коллекции, результат вызова → не дешёвый.</li>
     * </ul>
     */
    // ponytail: элемент — только переменная for-each по имени (корень выражения); элементы forEach-лямбд не распознаются
    private static boolean cheap(String s, MethodAnalysis m, ProjectAnalysis project, Set<String> elems, String recvType,
                                 Expression call, String target) {
        int bar = s.indexOf('|');
        String owner = s.substring(0, bar), name = s.substring(bar + 1);
        MethodAnalysis o = project.method(owner);
        if (o == null) {
            return recvType != null && (owner.equals(recvType) || owner.endsWith("." + recvType) || owner.endsWith("$" + recvType))
                    && project.isInstanceField(s);
        }
        String type = o.typeOf(name);
        if (type != null && SCALAR.contains(type)) return true;
        List<Parameter> params = o.declaration().getParameters();
        if (o != m) {
            if (o.isFresh(s) && (params.stream().anyMatch(p -> scalar(p) && p.getNameAsString().equals(root(name)))
                    || countingLoop(o, name))) return true;
            if (!owner.equals(target)) return false;
            List<Expression> args = args(call);
            for (int i = 0; i < Math.min(args.size(), params.size()); i++) {
                if (params.get(i).getNameAsString().equals(root(name)) && elems.contains(root(args.get(i).toString()))) return true;
            }
            return false;
        }
        if (elems.contains(root(name))) return true;
        MethodAnalysis callee = target == null ? null : project.method(target);
        if (callee == null) return false;
        List<Parameter> cps = callee.declaration().getParameters();
        List<Expression> args = args(call);
        for (int i = 0; i < Math.min(args.size(), cps.size()); i++) {
            String a = args.get(i).toString();
            if (scalar(cps.get(i)) && (a.equals(name) || a.startsWith(name + "."))) return true;
        }
        return false;
    }

    /** Символ {@code while@строка}/{@code for@строка}: в условии цикла только переменные-строки/числа и константы. */
    private static boolean countingLoop(MethodAnalysis o, String name) {
        if (!name.startsWith("while@") && !name.startsWith("for@")) return false;
        int line = Integer.parseInt(name.substring(name.indexOf('@') + 1));
        for (Node l : o.declaration().findAll(Node.class, n -> (n instanceof WhileStmt || n instanceof DoStmt || n instanceof ForStmt)
                && n.getBegin().map(p -> p.line).orElse(0) == line)) {
            Optional<Expression> cond = l instanceof WhileStmt w ? Optional.of(w.getCondition())
                    : l instanceof DoStmt d ? Optional.of(d.getCondition()) : ((ForStmt) l).getCompare();
            if (cond.isEmpty()) return true;
            boolean names = cond.get().findAll(NameExpr.class).stream().allMatch(n -> {
                String t = o.typeOf(n.getNameAsString());
                return t != null && SCALAR.contains(t);
            });
            boolean calls = cond.get().findAll(MethodCallExpr.class).stream().allMatch(c -> c.getScope().orElse(null) instanceof NameExpr);
            return names && calls;
        }
        return false;
    }

    private static boolean scalar(Parameter p) {
        return SCALAR.contains(MethodAnalysis.simpleType(p.getType()));
    }

    private static List<Expression> args(Expression call) {
        return call instanceof MethodCallExpr mc ? mc.getArguments() : ((ObjectCreationExpr) call).getArguments();
    }

    /** Корень выражения-имени символа: {@code o.getLines()} → {@code o}. */
    private static String root(String name) {
        return name.split("[^\\w$]", 2)[0];
    }

    private static boolean fresh(String s, ProjectAnalysis project) {
        MethodAnalysis o = project.method(s.substring(0, s.indexOf('|')));
        return o != null && o.isFresh(s);
    }

    /** Случай {@link LinearSearchInLoop}: поиск по значению у списка. */
    private static boolean linearSearch(Expression call, MethodAnalysis m, ProjectAnalysis project) {
        if (!(call instanceof MethodCallExpr mc) || mc.getScope().isEmpty() || mc.getArguments().size() != 1) return false;
        String type = project.typeOfExpr(mc.getScope().get(), m);
        return LIST_SEARCH.contains(mc.getNameAsString()) && type != null && JdkCosts.isList(type);
    }
}
