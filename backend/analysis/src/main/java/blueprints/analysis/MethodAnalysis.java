package blueprints.analysis;

import blueprints.model.Span;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.NodeList;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.body.RecordDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.stmt.DoStmt;
import com.github.javaparser.ast.stmt.ForEachStmt;
import com.github.javaparser.ast.stmt.ForStmt;
import com.github.javaparser.ast.stmt.IfStmt;
import com.github.javaparser.ast.stmt.LocalClassDeclarationStmt;
import com.github.javaparser.ast.stmt.LocalRecordDeclarationStmt;
import com.github.javaparser.ast.stmt.SwitchStmt;
import com.github.javaparser.ast.stmt.SynchronizedStmt;
import com.github.javaparser.ast.stmt.TryStmt;
import com.github.javaparser.ast.stmt.WhileStmt;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.ast.type.Type;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Анализ одного метода/конструктора: символы размера (§8.2), Big O (§8.1), стоимости вызовов, размеры циклов.
 * Символы размера — верхние оценки без учёта потока: тело проходится дважды, чтобы рост коллекции
 * в цикле ({@code out.add} после {@code out.indexOf}) был виден во всём методе.
 * Ключи символов: параметр и поле — своё имя; нераспознанное — {@code метод.переменная} или текст выражения.
 */
public final class MethodAnalysis {
    private static final Set<String> PASS_THROUGH = Set.of("size", "length", "clone", "subList", "stream",
            "parallelStream", "filter", "map", "sorted", "distinct", "toList", "collect", "toArray", "limit", "skip",
            "peek", "values", "keySet", "entrySet", "iterator", "listIterator", "toCharArray", "chars", "trim", "strip",
            "toUpperCase", "toLowerCase", "boxed", "mapToInt", "mapToObj", "mapToLong", "mapToDouble", "descendingSet",
            "descendingKeySet", "reversed", "getBytes", "substring", "toString");
    private static final Set<String> STATIC_COPY = Set.of("List.copyOf", "Set.copyOf", "Map.copyOf", "Arrays.copyOf",
            "Arrays.copyOfRange", "Arrays.asList", "Arrays.stream", "Collections.unmodifiableList",
            "Collections.unmodifiableSet", "Collections.unmodifiableMap", "Collections.unmodifiableCollection",
            "Collections.synchronizedList", "String.valueOf");
    private static final Set<String> STATIC_CONST = Set.of("List.of", "Set.of", "Map.of", "Collections.emptyList",
            "Collections.emptySet", "Collections.emptyMap", "Collections.singletonList", "Collections.singleton");
    private static final Set<String> ADDERS = Set.of("add", "addLast", "addFirst", "push", "offer", "put",
            "putIfAbsent", "append", "addElement");
    private static final Set<String> BULK_ADDERS = Set.of("addAll", "putAll");
    private static final Set<BinaryExpr.Operator> RELATIONAL = Set.of(BinaryExpr.Operator.LESS,
            BinaryExpr.Operator.LESS_EQUALS, BinaryExpr.Operator.GREATER, BinaryExpr.Operator.GREATER_EQUALS,
            BinaryExpr.Operator.NOT_EQUALS);
    private static final String RECURSION = "рекурсия, оценка неточная";

    private final ProjectAnalysis project;
    private final String id;
    private final String file;
    private final String name;
    private final CallableDeclaration<?> decl;
    private final TypeDeclaration<?> owner;
    private final List<String> params = new ArrayList<>();
    private final Set<String> locals = new LinkedHashSet<>();
    private final Map<String, String> types = new LinkedHashMap<>();
    /** Поле (своё или внешнего класса) → ключ символа {@code FQN|поле}. */
    private final Map<String, String> fieldKeys = new LinkedHashMap<>();
    private final Map<String, BigO> sizes = new LinkedHashMap<>();
    private final Map<Node, BigO> loopSizes = new IdentityHashMap<>();
    private final Map<Expression, BigO> callCosts = new IdentityHashMap<>();
    private final Map<Expression, String> callTargets = new IdentityHashMap<>();
    private final Set<String> warnings = new LinkedHashSet<>();
    /** Ключи новых символов для нераспознанных размеров (§8.2: выводы по ним — в «Предупреждения»). */
    private final Set<String> freshKeys = new LinkedHashSet<>();
    private BigO complexity;
    private boolean calleeLow;
    private boolean computing;

    MethodAnalysis(ProjectAnalysis project, String id, String file, CallableDeclaration<?> decl, TypeDeclaration<?> owner) {
        this.project = project;
        this.id = id;
        this.file = file;
        this.decl = decl;
        this.owner = owner;
        this.name = decl instanceof ConstructorDeclaration ? "<init>" : decl.getNameAsString();
        // ponytail: одно плоское пространство имён на метод (без областей видимости); поля — свои и внешних классов
        for (Node n = owner; n != null; n = n.getParentNode().orElse(null)) {
            if (!(n instanceof TypeDeclaration<?> td)) continue;
            String fqn = project.fqnOf(td);
            if (td instanceof RecordDeclaration r) r.getParameters().forEach(p -> {
                types.putIfAbsent(p.getNameAsString(), simpleType(p.getType()));
                fieldKeys.putIfAbsent(p.getNameAsString(), fqn + "|" + p.getNameAsString());
            });
            td.getFields().forEach(fd -> fd.getVariables().forEach(v -> {
                types.putIfAbsent(v.getNameAsString(), declaredType(v.getType(), v.getInitializer()));
                fieldKeys.putIfAbsent(v.getNameAsString(), fqn + "|" + v.getNameAsString());
            }));
        }
        for (Parameter p : decl.getParameters()) {
            params.add(key(p.getNameAsString()));
            types.put(p.getNameAsString(), simpleType(p.getType()));
            sizes.put(p.getNameAsString(), BigO.of(key(p.getNameAsString())));
        }
        body().ifPresent(b -> {
            for (VariableDeclarator v : b.findAll(VariableDeclarator.class)) {
                locals.add(v.getNameAsString());
                String t = declaredType(v.getType(), v.getInitializer());
                if (t != null) types.put(v.getNameAsString(), t);
            }
            for (Parameter p : b.findAll(Parameter.class)) {
                locals.add(p.getNameAsString());
                if (!p.getType().isUnknownType()) types.put(p.getNameAsString(), simpleType(p.getType()));
            }
        });
    }

    // ---- публичный API для детекторов ----

    public String id() {
        return id;
    }

    /** Имя метода; у конструктора — {@code <init>}. */
    public String name() {
        return name;
    }

    public String file() {
        return file;
    }

    public CallableDeclaration<?> declaration() {
        return decl;
    }

    /** Класс (или enum/record/interface), в котором объявлен метод. */
    public TypeDeclaration<?> owner() {
        return owner;
    }

    public Span span() {
        int b = decl.getBegin().map(p -> p.line).orElse(1);
        return new Span(file, b, decl.getEnd().map(p -> p.line).orElse(b));
    }

    /** Big O метода с учётом вызовов методов проекта. */
    public BigO complexity() {
        return complexity;
    }

    /** "high" | "low": low при рекурсии, while, нераспознанных размерах — у себя или у вызываемых. */
    public String confidence() {
        return warnings.isEmpty() && !calleeLow ? "high" : "low";
    }

    /** Почему оценка неточная (для вкладки «Предупреждения»). */
    public List<String> warnings() {
        return List.copyOf(warnings);
    }

    /** Символ размера выражения (коллекция, массив, строка, целая граница) или null, если не распознан. */
    public BigO size(Expression e) {
        return sizeExpr(e);
    }

    /** Символ заведён этим методом для нераспознанного размера (выражение, цикл без границы, while без границы). */
    public boolean isFresh(String symbol) {
        return freshKeys.contains(symbol);
    }

    /** Простое имя объявленного типа переменной/параметра/поля (конкретный тип из {@code new}, если есть) или null. */
    public String typeOf(String variable) {
        return types.get(variable);
    }

    /** Число итераций цикла (for, for-each, while, do, {@code x.forEach(...)}) или null, если узел не цикл. */
    public BigO loopSize(Node loop) {
        return loopSizes.get(loop);
    }

    /** Циклы, внутри тела которых стоит узел, от внешнего к внутреннему (итерируемое/инициализация for не в счёт). */
    public List<Node> enclosingLoops(Node n) {
        List<Node> out = new ArrayList<>();
        for (Node child = n, p = n.getParentNode().orElse(null); p != null && child != decl;
             child = p, p = p.getParentNode().orElse(null)) {
            if (!loopSizes.containsKey(p)) continue;
            Node c = child;
            boolean inBody = switch (p) {
                case ForEachStmt f -> c != f.getIterable();
                case ForStmt f -> f.getInitialization().stream().noneMatch(x -> x == c);
                case MethodCallExpr m -> m.getArguments().stream().anyMatch(x -> x == c);
                default -> true;
            };
            if (inBody) out.add(0, p);
        }
        return out;
    }

    /** Стоимость вызова (JDK по таблице или метод проекта по графу) или null, если O(1)/неизвестно. */
    public BigO callCost(Expression call) {
        return callCosts.get(call);
    }

    /** id вызываемого метода проекта ({@link MethodCallExpr}/{@link ObjectCreationExpr}) или null. */
    public String callTarget(Expression call) {
        return callTargets.get(call);
    }

    /** Строки метода: диапазон объявления от сигнатуры (с аннотациями, без javadoc) до закрывающей скобки, включая пустые и комментарии. */
    public int lines() {
        Span s = span();
        return s.endLine() - s.startLine() + 1;
    }

    /**
     * Глубина вложенности: тело метода — уровень 1, каждая управляющая конструкция добавляет уровень
     * (метод без конструкций — 1); см. {@link #deepestConstruct()}.
     */
    public int maxNesting() {
        Node d = deepestConstruct();
        return d == null ? 1 : nesting(d);
    }

    /**
     * Первая (в порядке исходника) конструкция с наибольшей глубиной или null. Уровень дают if/for/for-each/while/do/
     * switch/try/synchronized; else-if не углубляет; лямбда прозрачна (её тело — на уровне лямбды);
     * тела анонимных и локальных классов не считаются — это другой код (аргументы конструктора анонимного класса — считаются).
     */
    public Node deepestConstruct() {
        Node best = null;
        int max = 1;
        for (Node n : decl.findAll(Node.class, MethodAnalysis::isLevel)) {
            int d = nesting(n);
            if (d > max) { max = d; best = n; }
        }
        return best;
    }

    /** Глубина конструкции с учётом тела метода (1) или 0, если она внутри тела анонимного/локального класса. */
    private int nesting(Node n) {
        int d = 1;
        for (Node child = null, p = n; p != null && p != decl; child = p, p = p.getParentNode().orElse(null)) {
            if (p instanceof LocalClassDeclarationStmt || p instanceof LocalRecordDeclarationStmt) return 0;
            Node c = child;
            if (p instanceof ObjectCreationExpr oc && oc.getAnonymousClassBody().map(b -> b.stream().anyMatch(x -> x == c)).orElse(false)) return 0;
            if (isLevel(p)) d++;
        }
        return d;
    }

    private static boolean isLevel(Node n) {
        if (n instanceof IfStmt i) return !(i.getParentNode().orElse(null) instanceof IfStmt p && p.getElseStmt().orElse(null) == i);
        return n instanceof ForStmt || n instanceof ForEachStmt || n instanceof WhileStmt || n instanceof DoStmt
                || n instanceof SwitchStmt || n instanceof SwitchExpr || n instanceof TryStmt || n instanceof SynchronizedStmt;
    }

    // ---- для ProjectAnalysis ----

    boolean accepts(int argc) {
        NodeList<Parameter> ps = decl.getParameters();
        boolean varargs = !ps.isEmpty() && ps.getLast().get().isVarArgs();
        return argc == ps.size() || varargs && argc >= ps.size() - 1;
    }

    Set<String> resolveCalls() {
        Set<String> out = new LinkedHashSet<>();
        body().ifPresent(b -> b.findAll(Expression.class, e -> e instanceof MethodCallExpr || e instanceof ObjectCreationExpr)
                .forEach(e -> {
                    String t = project.resolve(e, this);
                    if (t != null) {
                        callTargets.put(e, t);
                        out.add(t);
                    }
                }));
        return out;
    }

    void compute() {
        if (complexity != null || computing) return;
        computing = true;
        Optional<? extends Node> b = body();
        if (b.isPresent()) {
            cost(b.get(), BigO.ONE); // проход 1: верхние оценки размеров
            complexity = cost(b.get(), BigO.ONE);
        } else {
            complexity = BigO.ONE;
        }
        computing = false;
    }

    static String simpleType(Type t) {
        return t instanceof ClassOrInterfaceType c ? c.getNameAsString() : t.asString();
    }

    // ---- разбор ----

    private Optional<? extends Node> body() {
        if (decl instanceof MethodDeclaration m) return m.getBody();
        return Optional.of(((ConstructorDeclaration) decl).getBody());
    }

    private static String declaredType(Type t, Optional<Expression> init) {
        if (init.isPresent() && init.get() instanceof ObjectCreationExpr oc) return oc.getType().getNameAsString();
        return t.isVarType() ? null : simpleType(t);
    }

    /** Стоимость узла за одно его выполнение; mult — сколько раз он выполняется (для роста коллекций). */
    private BigO cost(Node n, BigO mult) {
        if (n instanceof LocalClassDeclarationStmt || n instanceof LocalRecordDeclarationStmt || n instanceof TypeDeclaration) {
            return BigO.ONE;
        }
        if (n instanceof ForEachStmt f) {
            BigO s = loop(f, sizeOrFresh(f.getIterable()));
            return cost(f.getIterable(), mult).plus(s.times(cost(f.getBody(), mult.times(s))));
        }
        if (n instanceof ForStmt f) {
            BigO init = BigO.ONE;
            for (Expression e : f.getInitialization()) init = init.plus(cost(e, mult));
            BigO s = loop(f, forSize(f));
            BigO m = mult.times(s);
            BigO body = cost(f.getBody(), m);
            if (f.getCompare().isPresent()) body = body.plus(cost(f.getCompare().get(), m));
            for (Expression e : f.getUpdate()) body = body.plus(cost(e, m));
            return init.plus(s.times(body));
        }
        if (n instanceof WhileStmt w) return whileCost(w, w.getCondition(), w.getBody(), mult);
        if (n instanceof DoStmt d) return whileCost(d, d.getCondition(), d.getBody(), mult);
        if (n instanceof MethodCallExpr mc) return call(mc, mult);
        if (n instanceof ObjectCreationExpr oc) {
            BigO c = BigO.ONE;
            for (Expression a : oc.getArguments()) c = c.plus(cost(a, mult));
            String t = callTargets.get(oc);
            if (t != null) c = c.plus(record(oc, calleeCost(t, oc.getArguments())));
            return c;
        }
        BigO c = BigO.ONE;
        for (Node ch : n.getChildNodes()) c = c.plus(cost(ch, mult));
        if (n instanceof VariableDeclarator v && v.getInitializer().isPresent()) assign(v.getNameAsString(), v.getInitializer().get());
        if (n instanceof AssignExpr a && a.getOperator() == AssignExpr.Operator.ASSIGN) {
            String t = target(a.getTarget());
            if (t != null) assign(t, a.getValue());
        }
        return c;
    }

    private BigO whileCost(Node loop, Expression cond, Node body, BigO mult) {
        warnings.add("цикл while/do: число итераций оценено неточно");
        BigO s = null;
        for (BinaryExpr b : cond.findAll(BinaryExpr.class, x -> RELATIONAL.contains(x.getOperator()))) {
            for (Expression side : List.of(b.getLeft(), b.getRight())) {
                BigO x = sizeExpr(side);
                if (x != null && !x.isConstant()) s = s == null ? x : s.plus(x);
            }
        }
        if (s == null) s = fresh(key("while@" + loop.getBegin().map(p -> p.line).orElse(0)));
        loop(loop, s);
        BigO m = mult.times(s);
        return s.times(cost(cond, m).plus(cost(body, m)));
    }

    private BigO call(MethodCallExpr mc, BigO mult) {
        String n = mc.getNameAsString();
        NodeList<Expression> args = mc.getArguments();
        Expression scope = mc.getScope().orElse(null);
        BigO c = BigO.ONE;
        if (scope != null) c = c.plus(cost(scope, mult));
        BigO each = n.equals("forEach") && args.size() == 1 && scope != null ? loop(mc, sizeOrFresh(scope)) : null;
        for (Expression a : args) c = c.plus(each == null ? cost(a, mult) : each.times(cost(a, mult.times(each))));

        String recv = scope == null ? null : target(scope);
        if (recv != null && ADDERS.contains(n)) grow(recv, mult);
        if (recv != null && BULK_ADDERS.contains(n) && args.size() == 1) grow(recv, mult.times(sizeOrFresh(args.get(0))));

        String t = callTargets.get(mc);
        BigO cc = t != null ? calleeCost(t, args) : jdkCost(mc, scope);
        return cc == null ? c : c.plus(record(mc, cc));
    }

    private BigO record(Expression call, BigO cost) {
        callCosts.put(call, cost);
        return cost;
    }

    private BigO jdkCost(MethodCallExpr mc, Expression scope) {
        if (scope == null) return null;
        String type = project.typeOfExpr(scope, this);
        int argc = mc.getArguments().size();
        if (JdkCosts.lookup(type, mc.getNameAsString(), argc) == null) return null;
        Expression recv = scope;
        if (scope instanceof NameExpr ne && types.get(ne.getNameAsString()) == null && JdkCosts.isStaticUtility(type)) {
            if (argc == 0) return null;
            recv = mc.getArguments().get(type.equals("String") ? argc - 1 : 0);
        }
        return JdkCosts.cost(type, mc.getNameAsString(), argc, sizeOrFresh(recv));
    }

    private BigO calleeCost(String target, List<Expression> args) {
        MethodAnalysis callee = project.callGraph().sameCycle(id, target) ? null : project.method(target);
        if (callee == null || callee.complexity == null) {
            warnings.add(RECURSION);
            return BigO.ONE;
        }
        if (!"high".equals(callee.confidence())) calleeLow = true;
        Map<String, BigO> sub = new LinkedHashMap<>();
        for (int i = 0; i < Math.min(callee.params.size(), args.size()); i++) {
            BigO a = sizeExpr(args.get(i));
            sub.put(callee.params.get(i), a != null ? a : fresh(freshKey(args.get(i))));
        }
        return callee.complexity.substitute(sub);
    }

    // ---- символы размера ----

    private BigO loop(Node loop, BigO size) {
        loopSizes.put(loop, size);
        return size;
    }

    private void assign(String var, Expression value) {
        BigO s = sizeExpr(value);
        if (s != null) sizes.merge(var, s, BigO::plus);
    }

    private void grow(String var, BigO by) {
        BigO cur = nameSize(var);
        sizes.put(var, (cur != null ? cur : BigO.of(key(var))).plus(by));
    }

    /** Размер имени: известный; параметр/поле — свой символ; локальная с нераспознанным значением — null. */
    private BigO nameSize(String var) {
        BigO s = sizes.get(var);
        if (s != null) return s;
        return locals.contains(var) ? null : BigO.of(fieldKey(var));
    }

    private BigO fresh(String key) {
        freshKeys.add(key);
        return BigO.of(key);
    }

    private BigO sizeOrFresh(Expression e) {
        BigO s = sizeExpr(e);
        if (s != null) return s;
        warnings.add("размер «" + e + "» не распознан — взят новый символ");
        return fresh(freshKey(e));
    }

    /** Ключ нового символа: корень цепочки size()/length/stream()… — {@code mine.size()} и {@code mine} дают один символ. */
    private String freshKey(Expression e) {
        while (true) {
            if (e instanceof EnclosedExpr x) e = x.getInner();
            else if (e instanceof MethodCallExpr x && x.getScope().isPresent() && PASS_THROUGH.contains(x.getNameAsString())) e = x.getScope().get();
            else if (e instanceof FieldAccessExpr x && x.getNameAsString().equals("length")) e = x.getScope();
            else break;
        }
        if (e instanceof NameExpr ne) return locals.contains(ne.getNameAsString()) ? key(ne.getNameAsString()) : fieldKey(ne.getNameAsString());
        return key(e.toString());
    }

    /**
     * Ключи символов квалифицированы, чтобы символы вызываемого не сливались с одноимёнными у вызывающего:
     * параметр/локальная/новый символ — {@code methodId|имя}, поле — {@code FQN|поле}. {@link BigO#raw()} показывает часть после «|».
     */
    private String key(String local) {
        return id + "|" + local;
    }

    /** Поле своего/внешнего класса; неизвестное нелокальное имя (статический импорт и т.п.) — от класса-владельца. */
    private String fieldKey(String var) {
        return fieldKeys.getOrDefault(var, project.fqnOf(owner) + "|" + var);
    }

    private static String target(Expression e) {
        if (e instanceof NameExpr ne) return ne.getNameAsString();
        if (e instanceof FieldAccessExpr f && f.getScope() instanceof ThisExpr) return f.getNameAsString();
        return null;
    }

    private BigO sizeExpr(Expression e) {
        if (e instanceof IntegerLiteralExpr || e instanceof LongLiteralExpr || e instanceof CharLiteralExpr
                || e instanceof StringLiteralExpr || e instanceof ArrayInitializerExpr) return BigO.ONE;
        if (e instanceof EnclosedExpr x) return sizeExpr(x.getInner());
        if (e instanceof CastExpr x) return sizeExpr(x.getExpression());
        if (e instanceof UnaryExpr x) return sizeExpr(x.getExpression());
        if (e instanceof NameExpr x) return nameSize(x.getNameAsString());
        if (e instanceof FieldAccessExpr x) {
            if (x.getScope() instanceof ThisExpr) return nameSize(x.getNameAsString());
            return x.getNameAsString().equals("length") ? sizeExpr(x.getScope()) : null;
        }
        if (e instanceof MethodCallExpr x) {
            String n = x.getNameAsString();
            Optional<Expression> scope = x.getScope();
            if (scope.isPresent() && scope.get() instanceof NameExpr s && !types.containsKey(s.getNameAsString())) {
                String q = s.getNameAsString() + "." + n;
                if (STATIC_CONST.contains(q)) return BigO.ONE;
                if (STATIC_COPY.contains(q) && !x.getArguments().isEmpty()) return sizeExpr(x.getArguments().get(0));
                if (q.equals("Math.min") || q.equals("Math.max")) return both(x.getArguments().get(0), x.getArguments().get(1));
            }
            return scope.isPresent() && PASS_THROUGH.contains(n) ? sizeExpr(scope.get()) : null;
        }
        if (e instanceof ObjectCreationExpr x) {
            if (x.getArguments().isEmpty()) return BigO.ONE;
            return x.getArguments().size() == 1 ? sizeExpr(x.getArguments().get(0)) : null;
        }
        if (e instanceof ArrayCreationExpr x) {
            if (x.getInitializer().isPresent()) return BigO.ONE;
            return x.getLevels().get(0).getDimension().map(this::sizeExpr).orElse(null);
        }
        if (e instanceof ConditionalExpr x) return both(x.getThenExpr(), x.getElseExpr());
        if (e instanceof BinaryExpr x) {
            return switch (x.getOperator()) {
                case PLUS, MINUS -> both(x.getLeft(), x.getRight());
                case MULTIPLY -> {
                    BigO l = sizeExpr(x.getLeft()), r = sizeExpr(x.getRight());
                    yield l == null || r == null ? null : l.times(r);
                }
                case DIVIDE, SIGNED_RIGHT_SHIFT, UNSIGNED_RIGHT_SHIFT -> sizeExpr(x.getLeft());
                case REMAINDER -> sizeExpr(x.getRight());
                default -> null;
            };
        }
        return null;
    }

    private BigO both(Expression a, Expression b) {
        BigO x = sizeExpr(a), y = sizeExpr(b);
        return x == null || y == null ? null : x.plus(y);
    }

    /** for: граница из условия (сторона без переменной цикла); шаг *=, /=, сдвиг → log. */
    private BigO forSize(ForStmt f) {
        Set<String> vars = new LinkedHashSet<>();
        for (Expression e : f.getInitialization()) {
            if (e instanceof VariableDeclarationExpr v) v.getVariables().forEach(d -> vars.add(d.getNameAsString()));
            if (e instanceof AssignExpr a && target(a.getTarget()) != null) vars.add(target(a.getTarget()));
        }
        Expression bound = null;
        if (f.getCompare().isPresent()) {
            for (BinaryExpr b : f.getCompare().get().findAll(BinaryExpr.class, x -> RELATIONAL.contains(x.getOperator()))) {
                boolean l = mentions(b.getLeft(), vars), r = mentions(b.getRight(), vars);
                if (vars.isEmpty() || l != r) {
                    bound = l ? b.getRight() : b.getLeft();
                    break;
                }
            }
        }
        if (bound == null) {
            warnings.add("цикл for без распознанной границы — взят новый символ");
            return fresh(key("for@" + f.getBegin().map(p -> p.line).orElse(0)));
        }
        BigO s = sizeOrFresh(bound);
        // обратный цикл (i = a.length - 1; i >= 0): размер — начальное значение
        for (Expression e : f.getInitialization()) {
            List<Expression> starts = new ArrayList<>();
            if (e instanceof VariableDeclarationExpr v) v.getVariables().forEach(d -> d.getInitializer().ifPresent(starts::add));
            if (e instanceof AssignExpr a) starts.add(a.getValue());
            for (Expression st : starts) {
                BigO x = sizeExpr(st);
                if (x != null) s = s.plus(x);
            }
        }
        return f.getUpdate().stream().anyMatch(MethodAnalysis::geometric) ? s.log() : s;
    }

    private static boolean mentions(Expression e, Set<String> vars) {
        return e.findAll(NameExpr.class).stream().anyMatch(n -> vars.contains(n.getNameAsString()));
    }

    private static boolean geometric(Expression update) {
        if (!(update instanceof AssignExpr a)) return false;
        return switch (a.getOperator()) {
            case MULTIPLY, DIVIDE, LEFT_SHIFT, SIGNED_RIGHT_SHIFT, UNSIGNED_RIGHT_SHIFT -> true;
            case ASSIGN -> a.getValue() instanceof BinaryExpr b && switch (b.getOperator()) {
                case MULTIPLY, DIVIDE, LEFT_SHIFT, SIGNED_RIGHT_SHIFT, UNSIGNED_RIGHT_SHIFT -> true;
                default -> false;
            };
            default -> false;
        };
    }
}
