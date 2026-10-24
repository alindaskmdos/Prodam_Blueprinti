package blueprints.fixes;

import static blueprints.fixes.FixText.*;

import blueprints.analysis.LinearSearchInLoop;
import blueprints.analysis.MethodAnalysis;
import blueprints.analysis.ProjectAnalysis;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.FieldDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.expr.AssignExpr;
import com.github.javaparser.ast.expr.BooleanLiteralExpr;
import com.github.javaparser.ast.expr.CastExpr;
import com.github.javaparser.ast.expr.CharLiteralExpr;
import com.github.javaparser.ast.expr.DoubleLiteralExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.FieldAccessExpr;
import com.github.javaparser.ast.expr.IntegerLiteralExpr;
import com.github.javaparser.ast.expr.LongLiteralExpr;
import com.github.javaparser.ast.expr.LambdaExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.MethodReferenceExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.expr.SimpleName;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.ast.stmt.ForEachStmt;
import com.github.javaparser.ast.stmt.LocalClassDeclarationStmt;
import com.github.javaparser.ast.stmt.ReturnStmt;
import com.github.javaparser.ast.stmt.Statement;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.ast.type.Type;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Фикс §9 для {@code LinearSearchInLoop}: {@code xs.contains(e)} у списка в цикле →
 * {@code Set<T> xsSet = xs == null ? null : new LinkedHashSet<>(xs);} (NPE там же, где раньше) перед ближайшим циклом, в цикле {@code xsSet.contains(e)}
 * (все {@code xs.contains} этого цикла), импорт {@code java.util.Set/LinkedHashSet} при необходимости.
 * Правятся только эти диапазоны; перевод строки файла сохраняется.
 * <p>
 * target — id находки {@code LinearSearchInLoop:methodId:строка:колонка} (начало вызова). Только {@code contains};
 * узкий шаблон, иначе {@code canApply = false}: тип объявлен как {@code List/ArrayList/LinkedList<T>}, T — значимый тип JDK
 * (equals согласован с hashCode); в цикле список встречается только как получатель {@code contains}; цикл — оператор блока
 * на своей строке; вызов не в лямбде/анонимном классе; аргумент contains — примитив или ровно T.
 * Локальная только из {@code new ArrayList/LinkedList}: в методе нет использований, через которые список мог бы уйти
 * (передача в метод, алиас, лямбда, subList/iterator) — допустимы вызовы его методов, for-each, return, присваивание ему.
 * Всё остальное (поле, параметр, значение из вызова/другой переменной): в цикле нет другого вызова, {@code new}, лямбды.
 */
public final class LinkedHashSetFix implements Refactoring {
    public static final String ID = "linked-hash-set";

    private static final Set<String> LISTS = Set.of("List", "ArrayList", "LinkedList");
    // ponytail: только типы JDK с согласованными equals/hashCode; классы/record'ы проекта — когда появится проверка hashCode
    private static final Set<String> ELEMENTS = Set.of("String", "Integer", "Long", "Short", "Byte", "Character",
            "Boolean", "Double", "Float");
    private static final Set<String> PRIMITIVES = Set.of("int", "long", "short", "byte", "char", "boolean", "double", "float");
    // всё, что у ArrayList/LinkedList (List, SequencedCollection, Deque) даёт объект, через который меняется список
    private static final Set<String> VIEWS = Set.of("subList", "reversed", "iterator", "listIterator", "descendingIterator",
            "spliterator");

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

    private static Map<String, String> rewrite(Map<String, String> files, String target) {
        String[] t = target == null ? new String[0] : target.split(":");
        if (t.length < 4 || !t[0].equals("LinearSearchInLoop")) return null;
        int line, col;
        try {
            line = Integer.parseInt(t[t.length - 2]);
            col = Integer.parseInt(t[t.length - 1]);
        } catch (NumberFormatException e) {
            return null;
        }
        ProjectAnalysis project = ProjectAnalysis.of(sources(files));
        MethodAnalysis m = project.method(String.join(":", Arrays.copyOfRange(t, 1, t.length - 2)));
        // находка должна быть у детектора — сами вызовы не ищем
        if (m == null || new LinearSearchInLoop().detect(m, project).stream().noneMatch(i -> i.id().equals(target))) return null;
        MethodCallExpr call = m.declaration().findFirst(MethodCallExpr.class,
                c -> c.getBegin().filter(b -> b.line == line && b.column == col).isPresent()).orElse(null);
        if (call == null || !call.getNameAsString().equals("contains") || !(call.getScope().orElse(null) instanceof NameExpr scope)
                || insideClosure(call, m.declaration())) return null;
        List<Node> loops = m.enclosingLoops(call);
        if (loops.isEmpty()) return null;
        Node loop = loops.get(loops.size() - 1);
        String text = files.get(m.file());
        String indent = indent(text, loop);
        if (indent == null || !(loop instanceof Statement) || !(loop.getParentNode().orElse(null) instanceof BlockStmt)) return null;

        String xs = scope.getNameAsString();
        Type type = declaredType(m, loop, xs);
        String element = element(type);
        if (element == null) return null;
        // в цикле список — только получатель contains
        List<NameExpr> inLoop = loop.findAll(NameExpr.class, n -> n.getNameAsString().equals(xs));
        for (NameExpr n : inLoop) {
            if (!(n.getParentNode().orElse(null) instanceof MethodCallExpr c && c.getScope().orElse(null) == n
                    && c.getNameAsString().equals("contains") && c.getArguments().size() == 1
                    && argumentFits(m, c.getArgument(0), element))) return null;
        }
        if (loop.findFirst(FieldAccessExpr.class, f -> f.getNameAsString().equals(xs)).isPresent()) return null;
        // свой список (только new ArrayList/LinkedList этого метода) не должен уходить; всё остальное (поле, параметр,
        // значение из вызова или другой переменной) может быть алиасом — тогда в цикле не должно быть чужого кода
        if (fresh(m, xs) ? !doesNotEscape(m, loop, xs) : !noForeignCode(loop, inLoop)) return null;

        Set<String> taken = new LinkedHashSet<>();
        m.declaration().findAll(SimpleName.class).forEach(n -> taken.add(n.asString()));
        String set = xs + "Set";
        for (int i = 2; taken.contains(set); i++) set = xs + "Set" + i;

        CompilationUnit cu = m.declaration().findCompilationUnit().orElse(null);
        if (cu == null) return null;
        String nl = newline(text);
        List<Edit> imports = importEdits(cu, text, List.of("LinkedHashSet", "Set"));
        if (imports == null) return null;
        List<Edit> edits = new ArrayList<>(imports);
        edits.add(new Edit(start(text, loop), start(text, loop),
                "Set<" + element + "> " + set + " = " + xs + " == null ? null : new LinkedHashSet<>(" + xs + ");" + nl + indent));
        for (NameExpr n : inLoop) edits.add(new Edit(start(text, n), end(text, n), set));
        Map<String, String> res = new LinkedHashMap<>();
        res.put(m.file(), applyEdits(text, edits));
        return res;
    }

    /** Вызов внутри лямбды, анонимного или локального класса метода (может выполниться позже, при другом списке). */
    private static boolean insideClosure(Node n, Node decl) {
        for (Node p = n.getParentNode().orElse(null); p != null && p != decl; p = p.getParentNode().orElse(null)) {
            if (p instanceof LambdaExpr || p instanceof LocalClassDeclarationStmt
                    || p instanceof ObjectCreationExpr o && o.getAnonymousClassBody().isPresent()) return true;
        }
        return false;
    }

    /**
     * Объявленный тип списка: единственная локальная/параметр метода с этим именем, видимая в цикле (объявлена до него),
     * или поле класса, если в методе такого имени нет. Иначе null.
     */
    private static Type declaredType(MethodAnalysis m, Node loop, String xs) {
        List<VariableDeclarator> vars = m.declaration().findAll(VariableDeclarator.class, v -> v.getNameAsString().equals(xs));
        List<Parameter> params = m.declaration().findAll(Parameter.class, p -> p.getNameAsString().equals(xs));
        if (vars.size() + params.size() > 1) return null;
        if (params.size() == 1) return params.get(0).getParentNode().orElse(null) == m.declaration() ? params.get(0).getType() : null;
        if (vars.size() == 1) {
            VariableDeclarator v = vars.get(0);
            // локальная — оператор блока (не init for, не ресурс try)
            Node block = v.getParentNode().flatMap(Node::getParentNode).flatMap(Node::getParentNode).orElse(null);
            return block instanceof BlockStmt && !v.isDescendantOf(loop) && loop.isDescendantOf(block)
                    && v.getBegin().orElseThrow().isBefore(loop.getBegin().orElseThrow()) ? v.getType() : null;
        }
        return field(m, xs).map(VariableDeclarator::getType).orElse(null);
    }

    /** Локальная, которой присваивается только {@code new ArrayList/LinkedList(...)} (инициализатор и все присваивания). */
    private static boolean fresh(MethodAnalysis m, String xs) {
        List<VariableDeclarator> vs = m.declaration().findAll(VariableDeclarator.class, v -> v.getNameAsString().equals(xs));
        if (vs.size() != 1 || !isNewList(vs.get(0).getInitializer().orElse(null))) return false;
        return m.declaration().findAll(AssignExpr.class, a -> a.getTarget() instanceof NameExpr n && n.getNameAsString().equals(xs))
                .stream().allMatch(a -> a.getOperator() == AssignExpr.Operator.ASSIGN && isNewList(a.getValue()));
    }

    private static boolean isNewList(Node e) {
        return e instanceof ObjectCreationExpr o && o.getAnonymousClassBody().isEmpty()
                && Set.of("ArrayList", "LinkedList").contains(o.getType().getNameAsString());
    }

    /** Аргумент contains — примитив или ровно тип элемента (литерал, переменная, приведение); иначе equals может разойтись с hashCode. */
    private static boolean argumentFits(MethodAnalysis m, Expression arg, String element) {
        String t = switch (arg) {
            case StringLiteralExpr x -> "String";
            case IntegerLiteralExpr x -> "int";
            case LongLiteralExpr x -> "long";
            case CharLiteralExpr x -> "char";
            case DoubleLiteralExpr x -> "double";
            case BooleanLiteralExpr x -> "boolean";
            case CastExpr x -> x.getType().asString();
            case NameExpr x -> m.typeOf(x.getNameAsString());
            default -> null;
        };
        return t != null && (PRIMITIVES.contains(t) || t.equals(element) || ("java.lang." + t).equals(element));
    }

    private static Optional<VariableDeclarator> field(MethodAnalysis m, String xs) {
        return m.owner().getFieldByName(xs).map(FieldDeclaration::getVariables)
                .flatMap(vs -> vs.stream().filter(v -> v.getNameAsString().equals(xs)).findFirst());
    }

    /** {@code List<T>} с T из {@link #ELEMENTS} → текст T; иначе null. */
    private static String element(Type type) {
        if (!(type instanceof ClassOrInterfaceType c) || !LISTS.contains(c.getNameAsString())) return null;
        List<Type> args = c.getTypeArguments().map(List::copyOf).orElse(List.of());
        if (args.size() != 1 || !(args.get(0) instanceof ClassOrInterfaceType e) || e.getTypeArguments().isPresent()
                || !ELEMENTS.contains(e.getNameAsString())) return null;
        return e.asString();
    }

    /** Поле: в цикле, кроме наших contains, нет кода, который мог бы его изменить. */
    private static boolean noForeignCode(Node loop, List<NameExpr> ours) {
        return loop.findAll(MethodCallExpr.class, c -> ours.stream().noneMatch(n -> c.getScope().orElse(null) == n)).isEmpty()
                && loop.findAll(ObjectCreationExpr.class).isEmpty() && loop.findAll(LambdaExpr.class).isEmpty()
                && loop.findAll(MethodReferenceExpr.class).isEmpty();
    }

    /**
     * Локальная/параметр не уходит из метода и не получает алиасов: вне цикла — только вызов её метода (не view),
     * for-each по ней, return и присваивание ей; не в лямбде/анонимном классе.
     */
    private static boolean doesNotEscape(MethodAnalysis m, Node loop, String xs) {
        for (NameExpr n : m.declaration().findAll(NameExpr.class, x -> x.getNameAsString().equals(xs))) {
            if (n.isDescendantOf(loop)) continue;
            if (insideClosure(n, m.declaration())) return false;
            Node p = n.getParentNode().orElse(null);
            boolean ok = p instanceof MethodCallExpr c && c.getScope().orElse(null) == n && !VIEWS.contains(c.getNameAsString())
                    || p instanceof ForEachStmt f && f.getIterable() == n
                    || p instanceof ReturnStmt
                    || p instanceof AssignExpr a && a.getTarget() == n;
            if (!ok) return false;
        }
        return true;
    }
}
