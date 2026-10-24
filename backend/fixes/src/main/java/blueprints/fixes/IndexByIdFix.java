package blueprints.fixes;

import static blueprints.fixes.FixText.*;

import blueprints.analysis.MethodAnalysis;
import blueprints.analysis.NestedLoopSameCollection;
import blueprints.analysis.ProjectAnalysis;
import blueprints.source.SourceFile;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.EnumDeclaration;
import com.github.javaparser.ast.body.FieldDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.body.RecordDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.comments.Comment;
import com.github.javaparser.ast.expr.AssignExpr;
import com.github.javaparser.ast.expr.BinaryExpr;
import com.github.javaparser.ast.expr.BooleanLiteralExpr;
import com.github.javaparser.ast.expr.CharLiteralExpr;
import com.github.javaparser.ast.expr.ConditionalExpr;
import com.github.javaparser.ast.expr.DoubleLiteralExpr;
import com.github.javaparser.ast.expr.EnclosedExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.FieldAccessExpr;
import com.github.javaparser.ast.expr.IntegerLiteralExpr;
import com.github.javaparser.ast.expr.LongLiteralExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.NullLiteralExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.expr.SimpleName;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.expr.TextBlockLiteralExpr;
import com.github.javaparser.ast.expr.ThisExpr;
import com.github.javaparser.ast.expr.UnaryExpr;
import com.github.javaparser.ast.expr.VariableDeclarationExpr;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.ast.stmt.BreakStmt;
import com.github.javaparser.ast.stmt.ContinueStmt;
import com.github.javaparser.ast.stmt.DoStmt;
import com.github.javaparser.ast.stmt.EmptyStmt;
import com.github.javaparser.ast.stmt.ExpressionStmt;
import com.github.javaparser.ast.stmt.ForEachStmt;
import com.github.javaparser.ast.stmt.ForStmt;
import com.github.javaparser.ast.stmt.IfStmt;
import com.github.javaparser.ast.stmt.ReturnStmt;
import com.github.javaparser.ast.stmt.Statement;
import com.github.javaparser.ast.stmt.WhileStmt;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.ast.type.PrimitiveType;
import com.github.javaparser.ast.type.Type;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Фикс §9 «индекс по id» для {@code NestedLoopSameCollection}. Узкий шаблон (как {@code OrderService.merge}):
 * <pre>
 * for (int i = 0; i &lt; xs.size(); i++) {           Map&lt;K, T&gt; byKey = new LinkedHashMap&lt;&gt;();
 *     T a = xs.get(i);                               for (int i = 0; i &lt; xs.size(); i++) {
 *     if (!a.getS().m()) continue;                       T b = xs.get(i);
 *     for (int j = i + 1; j &lt; xs.size(); j++) {   →     if (!b.getS().m()) continue;
 *         T b = xs.get(j);                               T a = byKey.putIfAbsent(b.getK(), b);
 *         if (b.getS().m() &amp;&amp; a.getK() == b.getK()) {     if (a != null) { BODY }
 *             BODY                                   }
 * </pre>
 * Оригинал: первый «живой» (G = {@code getS().m()} истинно) элемент каждого ключа поглощает все следующие живые того же
 * ключа по порядку индексов, поглощённый становится не живым. Новый код делает те же тела в том же порядке внутри ключа;
 * между ключами порядок тел меняется, поэтому тело обязано коммутировать для разных ключей. Условия ({@code canApply}):
 * K — геттер final-поля примитива (сравнение {@code ==} без обёрток), S — геттер поля-enum'а проекта, m — {@code return}
 * из {@code this == C}/{@code !=}/{@code &&}/{@code ||}/{@code !}; T — класс проекта без наследников; тело содержит
 * верхнеуровневый {@code b.setS(E.C)} с m(C) = false, и всё тело (с методами T, record'ов/enum'ов, private-методами
 * владельца — рекурсивно) проходит белый список эффектов: пишет только поля a/b (поле S — только у b и только «мёртвой»
 * константой), меняет только собственные final-коллекции a/b из {@code new ArrayList/LinkedList} с неизменяемыми
 * элементами (примитивы, String, обёртки, enum'ы, record'ы из них) через get/size/isEmpty/add/set, локальные счётчики
 * метода — только {@code x++/x--} без чтения в цикле; без полей/this владельца, i/j, break/continue/return цикла,
 * throw/try/switch/лямбд/static-вызовов и методов JDK у значений. Иначе {@code canApply = false}.
 */
public final class IndexByIdFix implements Refactoring {
    public static final String ID = "index-by-id";

    private static final Map<String, String> KEYS = Map.of("int", "Integer", "long", "Long", "short", "Short",
            "byte", "Byte", "char", "Character", "boolean", "Boolean");
    private static final Set<String> JDK_VALUES = Set.of("int", "long", "short", "byte", "char", "boolean", "double",
            "float", "String", "Integer", "Long", "Short", "Byte", "Character", "Boolean", "Double", "Float");
    private static final Set<String> LISTS = Set.of("List", "ArrayList", "LinkedList");

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
        if (t.length < 4 || !t[0].equals("NestedLoopSameCollection")) return null;
        int line, col;
        try {
            line = Integer.parseInt(t[t.length - 2]);
            col = Integer.parseInt(t[t.length - 1]);
        } catch (NumberFormatException e) {
            return null;
        }
        List<SourceFile> sources = sources(files);
        ProjectAnalysis project = ProjectAnalysis.of(sources);
        MethodAnalysis m = project.method(String.join(":", Arrays.copyOfRange(t, 1, t.length - 2)));
        if (m == null || new NestedLoopSameCollection().detect(m, project).stream().noneMatch(i -> i.id().equals(target))) return null;
        ForStmt inner = m.declaration().findFirst(ForStmt.class,
                f -> f.getBegin().filter(b -> b.line == line && b.column == col).isPresent()).orElse(null);
        if (inner == null) return null;
        try {
            return new Shape(m, inner, projectTypes(files)).rewrite(files.get(m.file()));
        } catch (Reject e) {
            return null;
        }
    }

    /** Отказ разбора шаблона: canApply = false. */
    private static final class Reject extends RuntimeException {
        Reject() {
            super(null, null, false, false);
        }
    }

    private static <X> X need(X x) {
        if (x == null) throw new Reject();
        return x;
    }

    private static void need(boolean ok) {
        if (!ok) throw new Reject();
    }

    // ---- эффекты ----

    private enum Cat { A, B, COLL_A, COLL_B, VAL }

    /** Что за значение: элемент a/b, собственная коллекция a/b (type — тип элемента) или неизменяемое значение. */
    private record Kind(Cat cat, String type, String constant) {
        static Kind val(String type) {
            return new Kind(Cat.VAL, type, null);
        }
    }

    private static final Kind VOID = Kind.val("void");

    private enum Mode { BODY, OWNER, ELEMENT, VALUE }

    private static final class Scope {
        final Mode mode;
        final TypeDeclaration<?> type;
        final Kind self;
        final Map<String, Kind> env = new LinkedHashMap<>();
        int loops;
        Kind ret;

        Scope(Mode mode, TypeDeclaration<?> type, Kind self) {
            this.mode = mode;
            this.type = type;
            this.self = self;
        }
    }

    private static final class Shape {
        final MethodAnalysis m;
        final ForStmt inner;
        final Map<String, List<TypeDeclaration<?>>> types;
        final List<MethodDeclaration> stack = new ArrayList<>();
        ForStmt outer;
        ClassOrInterfaceDeclaration t;
        String tName, gField;
        EnumDeclaration gEnum;
        Expression gBody;

        Shape(MethodAnalysis m, ForStmt inner, Map<String, List<TypeDeclaration<?>>> types) {
            this.m = m;
            this.inner = inner;
            this.types = types;
        }

        Map<String, String> rewrite(String text) {
            BlockStmt innerBlock = need(inner.getParentNode().orElse(null) instanceof BlockStmt bs ? bs : null);
            outer = need(innerBlock.getParentNode().orElse(null) instanceof ForStmt f ? f : null);
            need(outer.getParentNode().orElse(null) instanceof BlockStmt);
            String ind = need(indent(text, outer));
            List<Statement> os = innerBlock.getStatements();
            need(os.size() == 3 && os.get(2) == inner);
            String i = counter(outer, null);
            String xs = need(sizeOf(outer.getCompare().orElse(null), i));
            String[] ad = decl(os.get(0), xs, i);
            String a = ad[1];
            tName = ad[0];
            IfStmt guard = need(os.get(1) instanceof IfStmt g && g.getElseStmt().isEmpty() ? g : null);
            need(isContinue(guard.getThenStmt()));
            MethodCallExpr gA = need(guard.getCondition() instanceof UnaryExpr u
                    && u.getOperator() == UnaryExpr.Operator.LOGICAL_COMPLEMENT ? g(u.getExpression(), a) : null);

            String j = counter(inner, i);
            need(xs.equals(sizeOf(inner.getCompare().orElse(null), j)));
            BlockStmt ib = need(inner.getBody() instanceof BlockStmt bs2 ? bs2 : null);
            need(ib.getStatements().size() == 2);
            String[] bd = decl(ib.getStatement(0), xs, j);
            String b = bd[1];
            need(bd[0].equals(tName) && Set.of(i, j, a, b, xs).size() == 5);
            IfStmt hit = need(ib.getStatement(1) instanceof IfStmt h && h.getElseStmt().isEmpty() ? h : null);
            BlockStmt body = need(hit.getThenStmt() instanceof BlockStmt bb ? bb : null);
            BinaryExpr and = need(hit.getCondition() instanceof BinaryExpr be && be.getOperator() == BinaryExpr.Operator.AND ? be : null);
            MethodCallExpr gB = need(g(and.getLeft(), b));
            need(gA.getNameAsString().equals(gB.getNameAsString())
                    && ((MethodCallExpr) gA.getScope().get()).getNameAsString().equals(((MethodCallExpr) gB.getScope().get()).getNameAsString()));
            BinaryExpr eq = need(and.getRight() instanceof BinaryExpr e2 && e2.getOperator() == BinaryExpr.Operator.EQUALS ? e2 : null);
            MethodCallExpr kA = key(eq.getLeft(), a), kB = key(eq.getRight(), b);
            if (kA == null || kB == null) {
                kA = key(eq.getRight(), a);
                kB = key(eq.getLeft(), b);
            }
            need(kA != null && kB != null && kA.getNameAsString().equals(kB.getNameAsString()));
            need(listOf(xs).equals(tName));

            // типы: T, ключ, поле статуса
            t = need(unique(tName) instanceof ClassOrInterfaceDeclaration c && !c.isInterface() && c.getTypeParameters().isEmpty() ? c : null);
            need(types.values().stream().flatMap(List::stream).noneMatch(x -> x instanceof ClassOrInterfaceDeclaration c
                    && c.getExtendedTypes().stream().anyMatch(e -> e.getNameAsString().equals(tName))));
            // анонимные подклассы new T(...) { ... } где угодно в проекте
            need(types.values().stream().flatMap(List::stream).noneMatch(x -> x.findFirst(ObjectCreationExpr.class,
                    o -> o.getAnonymousClassBody().isPresent() && o.getType().getNameAsString().equals(tName)).isPresent()));
            VariableDeclarator kf = need(getterField(kB.getNameAsString()));
            need(fieldDecl(kf).isFinal() && kf.getType() instanceof PrimitiveType);
            String keyType = need(KEYS.get(kf.getType().asString()));
            VariableDeclarator sf = need(getterField(((MethodCallExpr) gB.getScope().get()).getNameAsString()));
            gField = sf.getNameAsString();
            gEnum = need(sf.getType() instanceof ClassOrInterfaceType ct && enumType(ct.getNameAsString()) != null
                    ? enumType(ct.getNameAsString()) : null);
            MethodDeclaration gm = need(method(gEnum, gB.getNameAsString(), 0));
            gBody = need(gm.getBody().filter(bs -> bs.getStatements().size() == 1)
                    .map(bs -> bs.getStatement(0) instanceof ReturnStmt r ? r.getExpression().orElse(null) : null).orElse(null));

            // тело: «убивает» b и проходит белый список
            need(body.getStatements().stream().anyMatch(s -> kills(s, b)));
            Scope sc = new Scope(Mode.BODY, null, null);
            sc.env.put(a, new Kind(Cat.A, tName, null));
            sc.env.put(b, new Kind(Cat.B, tName, null));
            stmt(body, sc);
            // в обёртке цикла не должно потеряться ничего, кроме кода, который мы переписываем
            for (Comment c : inner.getAllContainedComments()) need(c.isDescendantOf(body) || inside(c, body));

            // текст
            Set<String> taken = new LinkedHashSet<>();
            m.declaration().findAll(SimpleName.class).forEach(n -> taken.add(n.asString()));
            String base = kB.getNameAsString().replaceFirst("^get(?=[A-Z])", "");
            if (base.endsWith("Id") && base.length() > 2) base = base.substring(0, base.length() - 2);
            String map = "by" + Character.toUpperCase(base.charAt(0)) + base.substring(1);
            for (int n = 2; taken.contains(map); n++) map = "by" + Character.toUpperCase(base.charAt(0)) + base.substring(1) + n;

            String innerInd = need(indent(text, inner)), hitInd = need(indent(text, hit));
            need(hitInd.startsWith(innerInd) && hitInd.length() > innerInd.length());
            String unit = hitInd.substring(innerInd.length());
            String nl = newline(text);
            String[] lines = slice(text, body).split("\r\n|\r|\n", -1);
            StringBuilder block = new StringBuilder(lines[0]);
            for (int k = 1; k < lines.length; k++) {
                String l = lines[k];
                need(l.isBlank() || l.startsWith(unit));
                block.append(nl).append(l.isBlank() ? l : l.substring(unit.length()));
            }

            CompilationUnit cu = need(m.declaration().findCompilationUnit().orElse(null));
            List<Edit> edits = new ArrayList<>(need(importEdits(cu, text, List.of("LinkedHashMap", "Map"))));
            edits.add(new Edit(start(text, outer), start(text, outer),
                    "Map<" + keyType + ", " + tName + "> " + map + " = new LinkedHashMap<>();" + nl + ind));
            VariableDeclarator av = ((VariableDeclarationExpr) ((ExpressionStmt) os.get(0)).getExpression()).getVariable(0);
            edits.add(new Edit(start(text, av.getName()), end(text, av.getName()), b));
            NameExpr ga = (NameExpr) ((MethodCallExpr) gA.getScope().get()).getScope().get();
            edits.add(new Edit(start(text, ga), end(text, ga), b));
            edits.add(new Edit(start(text, inner), end(text, inner),
                    tName + " " + a + " = " + map + ".putIfAbsent(" + slice(text, kB) + ", " + b + ");" + nl
                            + innerInd + "if (" + a + " != null) " + block));
            Map<String, String> res = new LinkedHashMap<>();
            res.put(m.file(), applyEdits(text, edits));
            return res;
        }

        private static boolean inside(Comment c, Node n) {
            return c.getBegin().isPresent() && n.getBegin().isPresent() && n.getEnd().isPresent()
                    && !c.getBegin().get().isBefore(n.getBegin().get()) && !n.getEnd().get().isBefore(c.getEnd().get());
        }

        /** {@code for (int i = 0 | i + 1; …; i++)} → имя i; from — имя внешнего счётчика (тогда init = from + 1). */
        private static String counter(ForStmt f, String from) {
            need(f.getInitialization().size() == 1 && f.getUpdate().size() == 1);
            VariableDeclarationExpr v = need(f.getInitialization().get(0) instanceof VariableDeclarationExpr x
                    && x.getVariables().size() == 1 && x.getModifiers().isEmpty() ? x : null);
            VariableDeclarator d = v.getVariable(0);
            need(d.getType().asString().equals("int"));
            Expression init = need(d.getInitializer().orElse(null));
            if (from == null) need(init instanceof IntegerLiteralExpr l && l.getValue().equals("0"));
            else need(init instanceof BinaryExpr be && be.getOperator() == BinaryExpr.Operator.PLUS
                    && be.getLeft() instanceof NameExpr n && n.getNameAsString().equals(from)
                    && be.getRight() instanceof IntegerLiteralExpr one && one.getValue().equals("1"));
            String name = d.getNameAsString();
            need(f.getUpdate().get(0) instanceof UnaryExpr u && u.getExpression() instanceof NameExpr n
                    && n.getNameAsString().equals(name) && (u.getOperator() == UnaryExpr.Operator.POSTFIX_INCREMENT
                    || u.getOperator() == UnaryExpr.Operator.PREFIX_INCREMENT));
            return name;
        }

        /** {@code i < xs.size()} → xs. */
        private static String sizeOf(Expression c, String i) {
            return c instanceof BinaryExpr be && be.getOperator() == BinaryExpr.Operator.LESS
                    && be.getLeft() instanceof NameExpr n && n.getNameAsString().equals(i)
                    && be.getRight() instanceof MethodCallExpr s && s.getNameAsString().equals("size") && s.getArguments().isEmpty()
                    && s.getScope().orElse(null) instanceof NameExpr x ? x.getNameAsString() : null;
        }

        /** {@code T a = xs.get(i);} → [T, a]. */
        private static String[] decl(Statement s, String xs, String i) {
            VariableDeclarationExpr v = need(s instanceof ExpressionStmt e && e.getExpression() instanceof VariableDeclarationExpr x
                    && x.getVariables().size() == 1 && x.getModifiers().isEmpty() ? x : null);
            VariableDeclarator d = v.getVariable(0);
            need(d.getType() instanceof ClassOrInterfaceType ct && ct.getTypeArguments().isEmpty() && ct.getScope().isEmpty());
            need(d.getInitializer().orElse(null) instanceof MethodCallExpr g && g.getNameAsString().equals("get")
                    && g.getScope().orElse(null) instanceof NameExpr x && x.getNameAsString().equals(xs)
                    && g.getArguments().size() == 1 && g.getArgument(0) instanceof NameExpr n && n.getNameAsString().equals(i));
            return new String[] {d.getType().asString(), d.getNameAsString()};
        }

        private static boolean isContinue(Statement s) {
            if (s instanceof BlockStmt b && b.getStatements().size() == 1) s = b.getStatement(0);
            return s instanceof ContinueStmt c && c.getLabel().isEmpty();
        }

        /** {@code x.getS().m()} → вызов m. */
        private static MethodCallExpr g(Expression e, String x) {
            return e instanceof MethodCallExpr mm && mm.getArguments().isEmpty()
                    && mm.getScope().orElse(null) instanceof MethodCallExpr s && s.getArguments().isEmpty()
                    && s.getScope().orElse(null) instanceof NameExpr n && n.getNameAsString().equals(x) ? mm : null;
        }

        /** {@code x.getK()}. */
        private static MethodCallExpr key(Expression e, String x) {
            return e instanceof MethodCallExpr k && k.getArguments().isEmpty()
                    && k.getScope().orElse(null) instanceof NameExpr n && n.getNameAsString().equals(x) ? k : null;
        }

        /** Объявленный тип списка xs ({@code List/ArrayList/LinkedList<T>}) → T. */
        private String listOf(String xs) {
            List<Type> found = new ArrayList<>();
            m.declaration().findAll(Parameter.class, p -> p.getNameAsString().equals(xs)).forEach(p -> found.add(p.getType()));
            m.declaration().findAll(VariableDeclarator.class, v -> v.getNameAsString().equals(xs)).forEach(v -> {
                need(!v.isDescendantOf(outer));
                found.add(v.getType());
            });
            if (found.isEmpty()) m.owner().getFieldByName(xs).ifPresent(f -> f.getVariables().stream()
                    .filter(v -> v.getNameAsString().equals(xs)).forEach(v -> found.add(v.getType())));
            need(found.size() == 1);
            ClassOrInterfaceType c = need(found.get(0) instanceof ClassOrInterfaceType x && jdkList(x.getNameAsString()) ? x : null);
            List<Type> args = c.getTypeArguments().map(List::copyOf).orElse(List.of());
            need(args.size() == 1);
            return args.get(0).asString();
        }

        /** List/ArrayList/LinkedList из JDK: имя не занято своим типом проекта. */
        private boolean jdkList(String name) {
            return LISTS.contains(name) && !types.containsKey(name);
        }

        private TypeDeclaration<?> unique(String name) {
            List<TypeDeclaration<?>> l = types.get(name.replaceFirst("^java\\.lang\\.", ""));
            return l != null && l.size() == 1 ? l.get(0) : null;
        }

        private EnumDeclaration enumType(String name) {
            return unique(name) instanceof EnumDeclaration e
                    && e.getEntries().stream().allMatch(c -> c.getClassBody().isEmpty()) ? e : null;
        }

        private static MethodDeclaration method(TypeDeclaration<?> type, String name, int arity) {
            List<MethodDeclaration> ms = type.getMethodsByName(name).stream()
                    .filter(md -> md.getParameters().size() == arity).toList();
            return ms.size() == 1 && ms.get(0).getBody().isPresent() ? ms.get(0) : null;
        }

        private static FieldDeclaration fieldDecl(VariableDeclarator v) {
            return (FieldDeclaration) v.getParentNode().orElseThrow();
        }

        private static VariableDeclarator field(TypeDeclaration<?> type, String name) {
            return type.getFieldByName(name).filter(f -> !f.isStatic()).flatMap(f -> f.getVariables().stream()
                    .filter(v -> v.getNameAsString().equals(name)).findFirst()).orElse(null);
        }

        /** Метод T без параметров вида {@code return f;} / {@code return this.f;} → поле f. */
        private VariableDeclarator getterField(String name) {
            MethodDeclaration md = method(t, name, 0);
            if (md == null || md.isStatic()) return null;
            List<Statement> ss = md.getBody().get().getStatements();
            if (ss.size() != 1 || !(ss.get(0) instanceof ReturnStmt r)) return null;
            Expression e = r.getExpression().orElse(null);
            String f = e instanceof NameExpr n ? n.getNameAsString()
                    : e instanceof FieldAccessExpr fa && fa.getScope() instanceof ThisExpr ? fa.getNameAsString() : null;
            VariableDeclarator v = f == null ? null : field(t, f);
            // тип возврата — ровно тип поля (иначе Integer getId() над int: == по ссылкам; long над int: не тот ключ)
            return v != null && md.getType().asString().equals(v.getType().asString()) ? v : null;
        }

        /** Верхнеуровневый {@code b.setS(E.C)}, где setS пишет поле статуса, а m(C) ложно. */
        private boolean kills(Statement s, String b) {
            if (!(s instanceof ExpressionStmt es && es.getExpression() instanceof MethodCallExpr c
                    && c.getScope().orElse(null) instanceof NameExpr n && n.getNameAsString().equals(b) && c.getArguments().size() == 1
                    && c.getArgument(0) instanceof FieldAccessExpr fa && fa.getScope() instanceof NameExpr en
                    && en.getNameAsString().equals(gEnum.getNameAsString()))) return false;
            MethodDeclaration md = method(t, c.getNameAsString(), 1);
            if (md == null || md.isStatic() || md.getBody().get().getStatements().size() != 1) return false;
            String p = md.getParameter(0).getNameAsString();
            return md.getBody().get().getStatement(0) instanceof ExpressionStmt w && w.getExpression() instanceof AssignExpr as
                    && as.getOperator() == AssignExpr.Operator.ASSIGN && as.getValue() instanceof NameExpr v && v.getNameAsString().equals(p)
                    && (as.getTarget() instanceof NameExpr tn && tn.getNameAsString().equals(gField) && !p.equals(gField)
                        || as.getTarget() instanceof FieldAccessExpr tf && tf.getScope() instanceof ThisExpr && tf.getNameAsString().equals(gField))
                    && Boolean.FALSE.equals(eval(gBody, fa.getNameAsString()));
        }

        /** Значение тела m() для константы c: только this ==/!= константа, !, &&, ||, литералы; иначе null. */
        private Boolean eval(Expression e, String c) {
            if (gEnum.getEntries().stream().noneMatch(x -> x.getNameAsString().equals(c))) return null;
            return switch (e) {
                case EnclosedExpr x -> eval(x.getInner(), c);
                case BooleanLiteralExpr x -> x.getValue();
                case UnaryExpr x when x.getOperator() == UnaryExpr.Operator.LOGICAL_COMPLEMENT -> {
                    Boolean v = eval(x.getExpression(), c);
                    yield v == null ? null : !v;
                }
                case BinaryExpr x when x.getOperator() == BinaryExpr.Operator.AND || x.getOperator() == BinaryExpr.Operator.OR -> {
                    Boolean l = eval(x.getLeft(), c), r = eval(x.getRight(), c);
                    yield l == null || r == null ? null : x.getOperator() == BinaryExpr.Operator.AND ? l && r : l || r;
                }
                case BinaryExpr x when x.getOperator() == BinaryExpr.Operator.EQUALS || x.getOperator() == BinaryExpr.Operator.NOT_EQUALS -> {
                    Expression o = x.getLeft() instanceof ThisExpr ? x.getRight() : x.getRight() instanceof ThisExpr ? x.getLeft() : null;
                    String k = o instanceof NameExpr n ? n.getNameAsString()
                            : o instanceof FieldAccessExpr fa && fa.getScope() instanceof NameExpr en
                                    && en.getNameAsString().equals(gEnum.getNameAsString()) ? fa.getNameAsString() : null;
                    if (k == null || gEnum.getEntries().stream().noneMatch(y -> y.getNameAsString().equals(k))) yield null;
                    yield (x.getOperator() == BinaryExpr.Operator.EQUALS) == k.equals(c);
                }
                default -> null;
            };
        }

        // ---- белый список эффектов ----

        private boolean isValue(String type, Set<String> seen) {
            String tn = type.replaceFirst("^java\\.lang\\.", "");
            if (JDK_VALUES.contains(tn) && unique(tn) == null) return true;
            if (!seen.add(tn)) return false;
            if (enumType(tn) != null) return true;
            return unique(tn) instanceof RecordDeclaration r && r.getTypeParameters().isEmpty()
                    && r.getParameters().stream().allMatch(p -> isValue(p.getType().asString(), seen));
        }

        private boolean isValue(String type) {
            return type != null && isValue(type, new LinkedHashSet<>());
        }

        /** Неявный toString значения не уходит в код проекта (свой toString у record/enum или у компонент). */
        private boolean plainToString(String type) {
            TypeDeclaration<?> td = unique(type);
            if (td == null) return true;
            if (method(td, "toString", 0) != null || !td.getMethodsByName("toString").isEmpty()) return false;
            return !(td instanceof RecordDeclaration r) || r.getParameters().stream().allMatch(p -> plainToString(p.getType().asString()));
        }

        /** Собственная коллекция: final, из new ArrayList/LinkedList, {@code List/ArrayList/LinkedList<значение>} → тип элемента. */
        private String ownCollection(VariableDeclarator v) {
            if (!fieldDecl(v).isFinal() || !(v.getType() instanceof ClassOrInterfaceType c) || !jdkList(c.getNameAsString())) return null;
            if (!(v.getInitializer().orElse(null) instanceof ObjectCreationExpr o) || o.getAnonymousClassBody().isPresent()
                    || !Set.of("ArrayList", "LinkedList").contains(o.getType().getNameAsString())
                    || !jdkList(o.getType().getNameAsString())) return null;
            List<Type> args = c.getTypeArguments().map(List::copyOf).orElse(List.of());
            return args.size() == 1 && isValue(args.get(0).asString()) ? args.get(0).asString() : null;
        }

        /** Чтение поля name у self (элемент a/b или значение). */
        private Kind readField(Kind self, String name) {
            if (self.cat() == Cat.A || self.cat() == Cat.B) {
                VariableDeclarator v = need(field(t, name));
                if (isValue(v.getType().asString())) return Kind.val(v.getType().asString());
                String el = need(ownCollection(v));
                return new Kind(self.cat() == Cat.A ? Cat.COLL_A : Cat.COLL_B, el, null);
            }
            need(self.cat() == Cat.VAL);
            TypeDeclaration<?> td = need(unique(self.type()));
            if (td instanceof EnumDeclaration e && e.getEntries().stream().anyMatch(c -> c.getNameAsString().equals(name))) {
                return new Kind(Cat.VAL, e.getNameAsString(), name);
            }
            if (td instanceof RecordDeclaration r) {
                for (Parameter p : r.getParameters()) if (p.getNameAsString().equals(name)) return Kind.val(p.getType().asString());
            }
            VariableDeclarator v = need(field(td, name));
            need(isValue(v.getType().asString()));
            return Kind.val(v.getType().asString());
        }

        /** Запись поля name у self: только a/b, не final, значение; поле статуса — только у b и «мёртвой» константой. */
        private void writeField(Kind self, String name, Kind value) {
            need(self.cat() == Cat.A || self.cat() == Cat.B);
            VariableDeclarator v = need(field(t, name));
            need(!fieldDecl(v).isFinal() && isValue(v.getType().asString()) && value.cat() == Cat.VAL);
            if (name.equals(gField)) {
                need(self.cat() == Cat.B && value.constant() != null && gEnum.getNameAsString().equals(value.type())
                        && Boolean.FALSE.equals(eval(gBody, value.constant())));
            }
        }

        private void stmt(Statement s, Scope sc) {
            switch (s) {
                case BlockStmt b -> b.getStatements().forEach(x -> stmt(x, sc));
                case ExpressionStmt e -> need(expr(e.getExpression(), sc));
                case EmptyStmt e -> { }
                case IfStmt i -> {
                    need(expr(i.getCondition(), sc).cat() == Cat.VAL);
                    stmt(i.getThenStmt(), sc);
                    i.getElseStmt().ifPresent(x -> stmt(x, sc));
                }
                case ForStmt f -> {
                    f.getInitialization().forEach(x -> need(expr(x, sc)));
                    f.getCompare().ifPresent(x -> need(expr(x, sc).cat() == Cat.VAL));
                    f.getUpdate().forEach(x -> need(expr(x, sc)));
                    loop(f.getBody(), sc);
                }
                case ForEachStmt f -> {
                    Kind it = expr(f.getIterable(), sc);
                    need(it.cat() == Cat.COLL_A || it.cat() == Cat.COLL_B);
                    need(f.getVariable().getVariables().size() == 1);
                    sc.env.put(f.getVariableDeclarator().getNameAsString(), Kind.val(it.type()));
                    loop(f.getBody(), sc);
                }
                case WhileStmt w -> {
                    need(expr(w.getCondition(), sc).cat() == Cat.VAL);
                    loop(w.getBody(), sc);
                }
                case DoStmt d -> {
                    loop(d.getBody(), sc);
                    need(expr(d.getCondition(), sc).cat() == Cat.VAL);
                }
                case BreakStmt b -> need(b.getLabel().isEmpty() && sc.loops > 0);
                case ContinueStmt c -> need(c.getLabel().isEmpty() && sc.loops > 0);
                case ReturnStmt r -> {
                    need(sc.mode != Mode.BODY);
                    Kind k = r.getExpression().map(x -> expr(x, sc)).orElse(VOID);
                    if (sc.ret == null) sc.ret = k;
                    else {
                        need(sc.ret.cat() == k.cat() && Objects.equals(sc.ret.type(), k.type()));
                        if (!Objects.equals(sc.ret.constant(), k.constant())) sc.ret = new Kind(k.cat(), k.type(), null);
                    }
                }
                default -> throw new Reject();
            }
        }

        private void loop(Statement body, Scope sc) {
            sc.loops++;
            stmt(body, sc);
            sc.loops--;
        }

        private Kind expr(Expression e, Scope sc) {
            return switch (e) {
                case IntegerLiteralExpr x -> Kind.val("int");
                case LongLiteralExpr x -> Kind.val("long");
                case CharLiteralExpr x -> Kind.val("char");
                case DoubleLiteralExpr x -> Kind.val("double");
                case BooleanLiteralExpr x -> Kind.val("boolean");
                case StringLiteralExpr x -> Kind.val("String");
                case TextBlockLiteralExpr x -> Kind.val("String");
                case NullLiteralExpr x -> Kind.val("null");
                case EnclosedExpr x -> expr(x.getInner(), sc);
                case ThisExpr x -> need(x.getTypeName().isEmpty() && (sc.mode == Mode.ELEMENT || sc.mode == Mode.VALUE) ? sc.self : null);
                case NameExpr x -> name(x.getNameAsString(), sc);
                case FieldAccessExpr x -> {
                    if (x.getScope() instanceof NameExpr n && !sc.env.containsKey(n.getNameAsString()) && enumType(n.getNameAsString()) != null
                            && !(sc.mode == Mode.ELEMENT && field(t, n.getNameAsString()) != null)) {
                        EnumDeclaration en = enumType(n.getNameAsString());
                        need(en.getEntries().stream().anyMatch(c -> c.getNameAsString().equals(x.getNameAsString())));
                        yield new Kind(Cat.VAL, en.getNameAsString(), x.getNameAsString());
                    }
                    yield readField(need(expr(x.getScope(), sc)), x.getNameAsString());
                }
                case VariableDeclarationExpr x -> {
                    for (VariableDeclarator v : x.getVariables()) {
                        Kind k = v.getInitializer().map(i -> expr(i, sc)).orElse(null);
                        if (k == null) {
                            need(isValue(v.getType().asString()));
                            k = Kind.val(v.getType().asString());
                        }
                        need(k != VOID);
                        sc.env.put(v.getNameAsString(), k);
                    }
                    yield VOID;
                }
                case ConditionalExpr x -> {
                    need(expr(x.getCondition(), sc).cat() == Cat.VAL);
                    Kind l = expr(x.getThenExpr(), sc), r = expr(x.getElseExpr(), sc);
                    need(l.cat() == r.cat());
                    yield l.equals(r) ? l : new Kind(l.cat(), Objects.equals(l.type(), r.type()) ? l.type() : null, null);
                }
                case BinaryExpr x -> binary(x, sc);
                case UnaryExpr x -> unary(x, sc);
                case AssignExpr x -> assign(x, sc);
                case MethodCallExpr x -> call(x, sc);
                case ObjectCreationExpr x -> {
                    need(x.getScope().isEmpty() && x.getAnonymousClassBody().isEmpty() && x.getTypeArguments().isEmpty());
                    RecordDeclaration r = need(unique(x.getType().getNameAsString()) instanceof RecordDeclaration rd
                            && rd.getConstructors().isEmpty() && rd.getCompactConstructors().isEmpty() && isValue(rd.getNameAsString()) ? rd : null);
                    for (Expression a : x.getArguments()) need(expr(a, sc).cat() == Cat.VAL);
                    yield Kind.val(r.getNameAsString());
                }
                default -> throw new Reject();
            };
        }

        private Kind name(String n, Scope sc) {
            Kind k = sc.env.get(n);
            if (k != null) return k;
            need(sc.mode == Mode.ELEMENT || sc.mode == Mode.VALUE);
            return readField(sc.self, n);
        }

        private Kind binary(BinaryExpr x, Scope sc) {
            Kind l = need(expr(x.getLeft(), sc)), r = need(expr(x.getRight(), sc));
            need(l != VOID && r != VOID);
            BinaryExpr.Operator op = x.getOperator();
            if (op == BinaryExpr.Operator.EQUALS || op == BinaryExpr.Operator.NOT_EQUALS) return Kind.val("boolean");
            need(l.cat() == Cat.VAL && r.cat() == Cat.VAL);
            if (op == BinaryExpr.Operator.PLUS && ("String".equals(l.type()) || "String".equals(r.type()))) {
                need(l.type() != null && r.type() != null && plainToString(l.type()) && plainToString(r.type()));
                return Kind.val("String");
            }
            return switch (op) {
                case LESS, LESS_EQUALS, GREATER, GREATER_EQUALS, AND, OR -> Kind.val("boolean");
                default -> Kind.val(l.type());
            };
        }

        private Kind unary(UnaryExpr x, Scope sc) {
            if (!x.isPrefix() && !x.isPostfix()) {
                Kind k = need(expr(x.getExpression(), sc));
                need(k.cat() == Cat.VAL && k != VOID);
                return x.getOperator() == UnaryExpr.Operator.LOGICAL_COMPLEMENT ? Kind.val("boolean") : Kind.val(k.type());
            }
            Expression target = x.getExpression();
            if (target instanceof NameExpr n && sc.env.containsKey(n.getNameAsString())) {
                need(sc.env.get(n.getNameAsString()).cat() == Cat.VAL);
                return sc.env.get(n.getNameAsString());
            }
            if (target instanceof NameExpr n && sc.mode == Mode.BODY) {
                need(x.getParentNode().orElse(null) instanceof ExpressionStmt);
                outerCounter(n.getNameAsString());
                return Kind.val("int");
            }
            return fieldTarget(target, sc);
        }

        /** Счётчик метода вне цикла: int/long, в цикле — только {@code x++/x--} отдельными операторами. */
        private void outerCounter(String n) {
            List<VariableDeclarator> ds = m.declaration().findAll(VariableDeclarator.class, v -> v.getNameAsString().equals(n));
            need(ds.size() == 1 && ds.get(0).getParentNode().orElse(null) instanceof VariableDeclarationExpr
                    && !ds.get(0).isDescendantOf(outer) && Set.of("int", "long").contains(ds.get(0).getType().asString()));
            need(m.declaration().findAll(Parameter.class, p -> p.getNameAsString().equals(n)).isEmpty());
            for (NameExpr u : outer.findAll(NameExpr.class, y -> y.getNameAsString().equals(n))) {
                need(u.getParentNode().orElse(null) instanceof UnaryExpr ue && (ue.isPrefix() || ue.isPostfix())
                        && ue.getParentNode().orElse(null) instanceof ExpressionStmt);
            }
        }

        /** Поле как цель ++/-- или составного присваивания (значение остаётся тем же типом). */
        private Kind fieldTarget(Expression target, Scope sc) {
            Kind self;
            String fname;
            if (target instanceof NameExpr n) {
                need(!sc.env.containsKey(n.getNameAsString()) && sc.mode == Mode.ELEMENT);
                self = sc.self;
                fname = n.getNameAsString();
            } else if (target instanceof FieldAccessExpr fa) {
                self = need(expr(fa.getScope(), sc));
                fname = fa.getNameAsString();
            } else {
                throw new Reject();
            }
            Kind cur = readField(self, fname);
            writeField(self, fname, cur);
            return cur;
        }

        private Kind assign(AssignExpr x, Scope sc) {
            Kind v = need(expr(x.getValue(), sc));
            need(v != VOID);
            boolean plain = x.getOperator() == AssignExpr.Operator.ASSIGN;
            if (!plain) need(v.cat() == Cat.VAL);
            if (x.getTarget() instanceof NameExpr n && sc.env.containsKey(n.getNameAsString())) {
                Kind cur = sc.env.get(n.getNameAsString());
                need(cur.cat() == v.cat());
                if (plain && !cur.equals(v)) sc.env.put(n.getNameAsString(), new Kind(cur.cat(),
                        Objects.equals(cur.type(), v.type()) ? cur.type() : null, null));
                return v;
            }
            if (!plain) return fieldTarget(x.getTarget(), sc);
            Kind self;
            String fname;
            if (x.getTarget() instanceof NameExpr n) {
                need(sc.mode == Mode.ELEMENT);
                self = sc.self;
                fname = n.getNameAsString();
            } else if (x.getTarget() instanceof FieldAccessExpr fa) {
                self = need(expr(fa.getScope(), sc));
                fname = fa.getNameAsString();
            } else {
                throw new Reject();
            }
            writeField(self, fname, v);
            return v;
        }

        private Kind call(MethodCallExpr c, Scope sc) {
            need(c.getTypeArguments().isEmpty());
            List<Kind> args = new ArrayList<>();
            for (Expression a : c.getArguments()) {
                Kind k = need(expr(a, sc));
                need(k != VOID);
                args.add(k);
            }
            String name = c.getNameAsString();
            Expression scope = c.getScope().orElse(null);
            if (scope == null) {
                return switch (sc.mode) {
                    case BODY, OWNER -> {
                        MethodDeclaration md = need(method(m.owner(), name, args.size()));
                        need(md.isPrivate() || md.isStatic());
                        yield inline(md, Mode.OWNER, m.owner(), null, args);
                    }
                    case ELEMENT -> elementCall(sc.self, name, args);
                    case VALUE -> valueCall(sc.self, name, args);
                };
            }
            if (scope instanceof NameExpr n && !sc.env.containsKey(n.getNameAsString()) && unique(n.getNameAsString()) != null
                    && !(sc.mode == Mode.ELEMENT && field(t, n.getNameAsString()) != null)) {
                throw new Reject(); // static-вызов
            }
            Kind self = need(expr(scope, sc));
            return switch (self.cat()) {
                case A, B -> elementCall(self, name, args);
                case COLL_A, COLL_B -> collectionCall(self, name, args);
                case VAL -> valueCall(self, name, args);
            };
        }

        private Kind elementCall(Kind self, String name, List<Kind> args) {
            MethodDeclaration md = need(method(t, name, args.size()));
            need(!md.isStatic());
            return inline(md, Mode.ELEMENT, t, self, args);
        }

        private Kind valueCall(Kind self, String name, List<Kind> args) {
            need(self != VOID && self.type() != null);
            TypeDeclaration<?> td = need(unique(self.type()));
            need(isValue(self.type()));
            MethodDeclaration md = method(td, name, args.size());
            if (md == null && td instanceof RecordDeclaration r && args.isEmpty() && td.getMethodsByName(name).isEmpty()) {
                for (Parameter p : r.getParameters()) if (p.getNameAsString().equals(name)) return Kind.val(p.getType().asString());
            }
            need(md != null && !md.isStatic());
            return inline(md, Mode.VALUE, td, new Kind(Cat.VAL, self.type(), null), args);
        }

        private static Kind collectionCall(Kind self, String name, List<Kind> args) {
            for (Kind a : args) need(a.cat() == Cat.VAL);
            return switch (name + "/" + args.size()) {
                case "size/0" -> Kind.val("int");
                case "isEmpty/0" -> Kind.val("boolean");
                case "get/1", "set/2" -> Kind.val(self.type());
                case "add/1" -> Kind.val("boolean");
                case "add/2" -> VOID;
                default -> throw new Reject();
            };
        }

        private Kind inline(MethodDeclaration md, Mode mode, TypeDeclaration<?> type, Kind self, List<Kind> args) {
            need(md.getTypeParameters().isEmpty() && stack.stream().noneMatch(x -> x == md) && stack.size() < 16);
            need(md.getParameters().stream().noneMatch(Parameter::isVarArgs));
            stack.add(md);
            Scope sc = new Scope(mode, type, self);
            for (int k = 0; k < args.size(); k++) sc.env.put(md.getParameter(k).getNameAsString(), args.get(k));
            stmt(md.getBody().get(), sc);
            stack.remove(stack.size() - 1);
            if (md.getType().isVoidType()) return VOID;
            return need(sc.ret);
        }
    }
}
