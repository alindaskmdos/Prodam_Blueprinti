package blueprints.fixes;

import static blueprints.fixes.FixText.*;

import blueprints.analysis.MethodAnalysis;
import blueprints.analysis.ProjectAnalysis;
import blueprints.analysis.StringConcatInLoop;
import blueprints.analysis.StringConcatInLoop.Concat;
import com.github.javaparser.JavaToken;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.expr.AssignExpr;
import com.github.javaparser.ast.expr.BinaryExpr;
import com.github.javaparser.ast.expr.CastExpr;
import com.github.javaparser.ast.expr.ClassExpr;
import com.github.javaparser.ast.expr.ConditionalExpr;
import com.github.javaparser.ast.expr.EnclosedExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.InstanceOfExpr;
import com.github.javaparser.ast.expr.LiteralExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.expr.ThisExpr;
import com.github.javaparser.ast.expr.UnaryExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.SimpleName;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.ast.stmt.BreakStmt;
import com.github.javaparser.ast.stmt.ContinueStmt;
import com.github.javaparser.ast.stmt.ExpressionStmt;
import com.github.javaparser.ast.stmt.Statement;
import com.github.javaparser.ast.nodeTypes.NodeWithTypeParameters;
import com.github.javaparser.ast.stmt.TryStmt;
import com.github.javaparser.ast.type.Type;
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
        ProjectAnalysis project = ProjectAnalysis.of(sources(files));
        MethodAnalysis m = project.method(String.join(":", Arrays.copyOfRange(t, 1, t.length - 2)));
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
            if (!safe(project, m, loop, vd, mine)) return null;
            String sb = s + "Sb";
            for (int i = 2; taken.contains(sb); i++) sb = s + "Sb" + i;
            taken.add(sb);
            before.append("StringBuilder ").append(sb).append(" = new StringBuilder(").append(s).append(");").append(nl).append(indent);
            after.append(nl).append(indent).append(s).append(" = ").append(sb).append(".toString();");
            for (Concat c : mine) {
                List<String> args = appendArgs(text, c.at());
                if (args == null) return null;
                StringBuilder call = new StringBuilder(sb);
                for (String a : args) call.append(".append(").append(a).append(')');
                edits.add(new Edit(start(text, c.at()), end(text, c.at()), call.toString()));
            }
        }
        edits.add(new Edit(start(text, loop), start(text, loop), before.toString()));
        edits.add(new Edit(end(text, loop), end(text, loop), after.toString()));
        Map<String, String> res = new LinkedHashMap<>();
        res.put(m.file(), applyEdits(text, edits));
        return res;
    }

    private static boolean safe(ProjectAnalysis project, MethodAnalysis m, Node loop, VariableDeclarator vd, List<Concat> mine) {
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
            // String + char[] = "[C@…", append(char[]) — символы: статический тип каждого слагаемого точно не массив
            for (Expression e : appended(c.at())) if (!notArray(project, m, e)) return false;
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

    /**
     * Аргументы append — текст от оператора ({@code +=} / {@code +}) до конца слагаемого, с комментариями перед ним
     * ({@code s += /*c*&#47; x} → {@code /*c*&#47; x}); null — комментарий в другом месте присваивания (потерялся бы).
     */
    private static List<String> appendArgs(String text, AssignExpr a) {
        List<JavaToken> tokens = new ArrayList<>();
        a.getTokenRange().orElseThrow().forEach(tokens::add);
        List<int[]> kept = new ArrayList<>();
        List<String> out = new ArrayList<>();
        for (Expression e : appended(a)) {
            int from = start(text, e), opEnd = -1;
            for (JavaToken t : tokens) {
                if (offset(text, t.getRange().orElseThrow().begin) >= from) break;
                JavaToken.Kind k = JavaToken.Kind.valueOf(t.getKind());
                if (k == JavaToken.Kind.PLUS || k == JavaToken.Kind.PLUSASSIGN) opEnd = offset(text, t.getRange().orElseThrow().end) + 1;
            }
            if (opEnd < 0) return null;
            kept.add(new int[] {opEnd, end(text, e)});
            out.add(text.substring(opEnd, end(text, e)).strip());
        }
        for (JavaToken t : tokens) {
            if (t.getCategory() != JavaToken.Category.COMMENT) continue;
            int at = offset(text, t.getRange().orElseThrow().begin);
            if (kept.stream().noneMatch(r -> at >= r[0] && at < r[1])) return null;
        }
        return out;
    }

    // ponytail: JDK-методы без резолва типов — белые списки по имени; вызов вне списков и без своего объявления → отказ
    /** Всегда возвращают не массив (String, примитив, enum), у любого получателя. */
    private static final Set<String> NON_ARRAY_JDK = Set.of("toString", "valueOf", "format", "formatted", "trim",
            "strip", "stripLeading", "stripTrailing", "substring", "toUpperCase", "toLowerCase", "repeat", "concat", "replace",
            "replaceAll", "replaceFirst", "length", "size", "charAt", "name", "ordinal", "hashCode", "equals", "isEmpty",
            "isBlank", "indexOf", "lastIndexOf", "contains", "startsWith", "endsWith", "compareTo", "getName", "getSimpleName");
    /** Возвращают элемент получателя (тип из его аргументов типа): получатель — переменная без массивов в объявленном типе. */
    private static final Set<String> ELEMENT_JDK = Set.of("get", "getFirst", "getLast", "getOrDefault", "peek", "peekFirst",
            "peekLast", "poll", "pollFirst", "pollLast", "pop", "remove", "removeFirst", "removeLast", "element", "next",
            "previous", "orElse", "orElseGet", "orElseThrow", "getKey", "getValue", "take", "join", "requireNonNull",
            "requireNonNullElse", "max", "min");
    /** Могут вернуть char[] даже при «чистом» получателе. */
    private static final Set<String> ARRAY_JDK = Set.of("toCharArray", "toArray", "clone", "getBytes", "split", "copyOf",
            "copyOfRange", "array", "readPassword", "getPassword");

    /** Статический тип выражения точно не массив (консервативно: не определили — false). */
    private static boolean notArray(ProjectAnalysis project, MethodAnalysis m, Expression e) {
        return switch (e) {
            case EnclosedExpr x -> notArray(project, m, x.getInner());
            case ConditionalExpr x -> notArray(project, m, x.getThenExpr()) && notArray(project, m, x.getElseExpr());
            // литералы, арифметика/конкатенация/сравнение, new класса — примитив, String или класс
            case LiteralExpr x -> true;
            case BinaryExpr x -> true;
            case UnaryExpr x -> true;
            case InstanceOfExpr x -> true;
            case ThisExpr x -> true;
            case ClassExpr x -> true;
            case ObjectCreationExpr x -> true;
            case CastExpr x -> !x.getType().isArrayType();
            case NameExpr x -> plainTypes(declaredTypes(m, x.getNameAsString()));
            case MethodCallExpr x -> notArrayCall(project, m, x);
            default -> false;
        };
    }

    /** Объявления есть, и ни одно не массив/var/без типа (лямбда), и в аргументах типа нет массивов. */
    private static boolean plainTypes(List<Type> ts) {
        return !ts.isEmpty() && ts.stream().allMatch(t -> !t.isArrayType() && !t.isVarType() && !t.isUnknownType());
    }

    private static boolean notArrayCall(ProjectAnalysis project, MethodAnalysis m, MethodCallExpr c) {
        String name = c.getNameAsString();
        if (ARRAY_JDK.contains(name) || c.getTypeArguments().filter(a -> a.toString().contains("[")).isPresent()) return false;
        // статические методы String (valueOf, format, join, copyValueOf) возвращают String
        if (c.getScope().orElse(null) instanceof NameExpr n && n.getNameAsString().equals("String")
                && declaredTypes(m, "String").isEmpty()) return true;
        // все одноимённые методы проекта: возврат не массив и не параметр типа (его выводит место вызова)
        boolean own = false;
        for (MethodAnalysis a : project.methods()) {
            if (!(a.declaration() instanceof MethodDeclaration d) || !d.getNameAsString().equals(name)) continue;
            if (d.getType().isArrayType() || typeParameters(d).contains(d.getType().asString())) return false;
            own = true;
        }
        if (ELEMENT_JDK.contains(name)) {
            // элемент контейнера: тип элемента — из объявления получателя
            if (!(c.getScope().orElse(null) instanceof NameExpr recv)) return false;
            List<Type> ts = declaredTypes(m, recv.getNameAsString());
            return plainTypes(ts) && ts.stream().noneMatch(t -> t.asString().contains("["));
        }
        return own || NON_ARRAY_JDK.contains(name);
    }

    /** Имена параметров типа метода и всех охватывающих его типов. */
    private static Set<String> typeParameters(MethodDeclaration d) {
        Set<String> out = new LinkedHashSet<>();
        d.getTypeParameters().forEach(p -> out.add(p.getNameAsString()));
        for (Node n = d.getParentNode().orElse(null); n != null; n = n.getParentNode().orElse(null)) {
            if (n instanceof NodeWithTypeParameters<?> g) g.getTypeParameters().forEach(p -> out.add(p.getNameAsString()));
        }
        return out;
    }

    /** Все объявления имени в методе (параметры, локальные, лямбды) и поля охватывающих типов — пространство имён плоское. */
    private static List<Type> declaredTypes(MethodAnalysis m, String name) {
        List<Type> out = new ArrayList<>();
        m.declaration().findAll(Parameter.class, p -> p.getNameAsString().equals(name)).forEach(p -> out.add(p.getType()));
        m.declaration().findAll(VariableDeclarator.class, v -> v.getNameAsString().equals(name)).forEach(v -> out.add(v.getType()));
        for (Node n = m.owner(); n != null; n = n.getParentNode().orElse(null)) {
            if (n instanceof TypeDeclaration<?> td) td.getFieldByName(name).ifPresent(f -> f.getVariables().stream()
                    .filter(v -> v.getNameAsString().equals(name)).forEach(v -> out.add(v.getType())));
        }
        return out;
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
