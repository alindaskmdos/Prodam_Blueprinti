package blueprints.analysis;

import blueprints.source.SourceFile;
import com.github.javaparser.JavaParser;
import com.github.javaparser.ParseResult;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.expr.CastExpr;
import com.github.javaparser.ast.expr.EnclosedExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.FieldAccessExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.expr.SuperExpr;
import com.github.javaparser.ast.expr.ThisExpr;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Анализ проекта целиком: разбор файлов, индекс методов (id как в дереве проекта), граф вызовов,
 * ленивые {@link MethodAnalysis} с мемоизацией Big O по графу вызовов.
 * Файл, который JavaParser не разобрал, пропускается с предупреждением — его методов в анализе нет.
 * Резолв вызовов текстовый (объявленные типы переменных/полей, имена классов проекта), без Symbol Solver.
 */
public final class ProjectAnalysis {
    /** Тип проекта: fqn, пакет, объявление. */
    record TypeInfo(String fqn, String pkg, TypeDeclaration<?> decl) {}

    private final Map<String, MethodAnalysis> methods = new LinkedHashMap<>();
    private final Map<String, List<TypeInfo>> typesBySimpleName = new LinkedHashMap<>();
    private final Map<TypeDeclaration<?>, TypeInfo> typeOf = new java.util.IdentityHashMap<>();
    private final Map<String, List<MethodAnalysis>> methodsByType = new LinkedHashMap<>();
    private final List<String> warnings = new ArrayList<>();
    private final List<CompilationUnit> units = new ArrayList<>();
    private Set<String> stringLiterals;
    private final CallGraph callGraph;
    private final long n;

    private ProjectAnalysis(List<SourceFile> files, long n) {
        this.n = n;
        JavaParser parser = new JavaParser(new ParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21));
        for (SourceFile f : files) {
            ParseResult<CompilationUnit> r = parser.parse(f.text());
            if (!r.isSuccessful() || r.getResult().isEmpty()) {
                warnings.add(f.path() + ": файл не разобран, сложность его методов неизвестна");
                continue;
            }
            units.add(r.getResult().get());
            for (TypeDeclaration<?> t : r.getResult().get().getTypes()) index(t, f);
        }
        Map<String, Set<String>> edges = new LinkedHashMap<>();
        for (MethodAnalysis m : methods.values()) edges.put(m.id(), m.resolveCalls());
        callGraph = new CallGraph(edges);
    }

    public static ProjectAnalysis of(List<SourceFile> files) {
        return of(files, Issues.DEFAULT_N);
    }

    /** n — размер входа для «≈ операций» (opsBefore/opsAfter) проблем детекторов (§8.4). */
    public static ProjectAnalysis of(List<SourceFile> files, long n) {
        if (n < 1) throw new IllegalArgumentException("n должно быть ≥ 1: " + n);
        return new ProjectAnalysis(files, n);
    }

    public long n() {
        return n;
    }

    /** Все методы и конструкторы проекта в порядке файлов; сложность посчитана. */
    public List<MethodAnalysis> methods() {
        methods.values().forEach(MethodAnalysis::compute);
        return List.copyOf(methods.values());
    }

    /** Анализ метода по id или null. */
    public MethodAnalysis method(String id) {
        MethodAnalysis m = methods.get(id);
        if (m != null) m.compute();
        return m;
    }

    public CallGraph callGraph() {
        return callGraph;
    }

    /** Предупреждения уровня проекта (неразобранные файлы). */
    public List<String> warnings() {
        return warnings;
    }

    // ---- индекс: тот же порядок и нумерация перегрузок, что в source.TreeBuilder ----

    private void index(TypeDeclaration<?> t, SourceFile f) {
        String fqn = f.pkg().isEmpty() ? binary(t) : f.pkg() + "." + binary(t);
        TypeInfo info = new TypeInfo(fqn, f.pkg(), t);
        typeOf.put(t, info);
        typesBySimpleName.computeIfAbsent(t.getNameAsString(), k -> new ArrayList<>()).add(info);
        List<MethodAnalysis> own = methodsByType.computeIfAbsent(fqn, k -> new ArrayList<>());
        int ctor = 0;
        for (var c : t.getConstructors()) add(new MethodAnalysis(this, fqn + ".<init>~" + ctor++, f.path(), c, t), own);
        Map<String, Integer> idx = new LinkedHashMap<>();
        for (var m : t.getMethods()) {
            int i = idx.merge(m.getNameAsString(), 1, Integer::sum) - 1;
            add(new MethodAnalysis(this, fqn + "." + m.getNameAsString() + "~" + i, f.path(), m, t), own);
        }
        t.getMembers().forEach(m -> { if (m instanceof TypeDeclaration<?> n) index(n, f); });
    }

    private void add(MethodAnalysis m, List<MethodAnalysis> own) {
        methods.put(m.id(), m);
        own.add(m);
    }

    private static String binary(TypeDeclaration<?> td) {
        return td.getParentNode().filter(p -> p instanceof TypeDeclaration)
                .map(p -> binary((TypeDeclaration<?>) p) + "$" + td.getNameAsString()).orElse(td.getNameAsString());
    }

    // ---- резолв ----

    String fqnOf(TypeDeclaration<?> td) {
        TypeInfo i = typeOf.get(td);
        return i != null ? i.fqn() : td.getNameAsString();
    }

    /** Символ {@code FQN|поле} — нестатическое поле (или компонент record) класса проекта с этим FQN. */
    boolean isInstanceField(String symbol) {
        int bar = symbol.indexOf('|');
        String fqn = symbol.substring(0, bar), field = symbol.substring(bar + 1);
        for (TypeInfo t : typeOf.values()) {
            if (!t.fqn().equals(fqn)) continue;
            if (t.decl() instanceof com.github.javaparser.ast.body.RecordDeclaration r
                    && r.getParameters().stream().anyMatch(p -> p.getNameAsString().equals(field))) return true;
            return t.decl().getFieldByName(field).map(f -> !f.isStatic()).orElse(false);
        }
        return false;
    }

    /** Значения строковых литералов проекта (рефлексия: {@code getDeclaredMethod("m")}). */
    Set<String> stringLiterals() {
        if (stringLiterals == null) {
            Set<String> s = new java.util.LinkedHashSet<>();
            for (CompilationUnit cu : units) cu.findAll(StringLiteralExpr.class).forEach(l -> s.add(l.getValue()));
            stringLiterals = s;
        }
        return stringLiterals;
    }

    boolean isProjectType(String simple) {
        return typesBySimpleName.containsKey(simple);
    }

    /** id вызываемого метода/конструктора проекта или null (JDK, неизвестный тип, неоднозначность). */
    String resolve(Expression call, MethodAnalysis ctx) {
        if (call instanceof ObjectCreationExpr oc) {
            if (oc.getAnonymousClassBody().isPresent()) return null;
            return find(typesFor(oc.getType().getNameAsString(), ctx), "<init>", oc.getArguments().size());
        }
        if (!(call instanceof MethodCallExpr mc)) return null;
        String name = mc.getNameAsString();
        int argc = mc.getArguments().size();
        Optional<Expression> scope = mc.getScope();
        if (scope.isEmpty() || scope.get() instanceof ThisExpr || scope.get() instanceof SuperExpr) {
            List<TypeInfo> chain = new ArrayList<>();
            for (Node n = ctx.owner(); n != null; n = n.getParentNode().orElse(null)) {
                if (n instanceof TypeDeclaration<?> td && typeOf.containsKey(td)) chain.add(typeOf.get(td));
            }
            return find(chain, name, argc);
        }
        String type = typeOfExpr(scope.get(), ctx);
        if (type != null) return find(typesFor(type, ctx), name, argc);
        // ponytail: тип получателя неизвестен — берём метод, только если он единственный с таким именем и арностью
        List<String> all = new ArrayList<>();
        for (MethodAnalysis m : methods.values()) if (m.name().equals(name) && m.accepts(argc)) all.add(m.id());
        return all.size() == 1 ? all.get(0) : null;
    }

    /** Простое имя типа выражения или null. */
    String typeOfExpr(Expression e, MethodAnalysis ctx) {
        if (e instanceof EnclosedExpr x) return typeOfExpr(x.getInner(), ctx);
        if (e instanceof CastExpr x) return MethodAnalysis.simpleType(x.getType());
        if (e instanceof StringLiteralExpr) return "String";
        if (e instanceof ThisExpr) return ctx.owner().getNameAsString();
        if (e instanceof ObjectCreationExpr x) return x.getType().getNameAsString();
        if (e instanceof NameExpr x) {
            String t = ctx.typeOf(x.getNameAsString());
            if (t != null) return t;
            String n = x.getNameAsString();
            return !n.isEmpty() && Character.isUpperCase(n.charAt(0)) ? n : null; // статический вызов Class.m()
        }
        if (e instanceof FieldAccessExpr x && x.getScope() instanceof ThisExpr) return ctx.typeOf(x.getNameAsString());
        if (e instanceof MethodCallExpr x) {
            String target = ctx.callTarget(x);
            MethodAnalysis m = methods.get(target != null ? target : resolve(x, ctx));
            if (m != null && m.declaration() instanceof MethodDeclaration md) return MethodAnalysis.simpleType(md.getType());
        }
        return null;
    }

    /** Типы проекта с таким простым именем; свой пакет первым. Не тип проекта → пусто. */
    private List<TypeInfo> typesFor(String simple, MethodAnalysis ctx) {
        List<TypeInfo> list = new ArrayList<>(typesBySimpleName.getOrDefault(simple, List.of()));
        String pkg = typeOf.get(ctx.owner()).pkg();
        list.sort((a, b) -> Boolean.compare(!a.pkg().equals(pkg), !b.pkg().equals(pkg)));
        return list;
    }

    // ponytail: перегрузки одной арности не различаются по типам аргументов — берётся первая
    private String find(List<TypeInfo> types, String name, int argc) {
        for (TypeInfo t : types) {
            for (MethodAnalysis m : methodsByType.getOrDefault(t.fqn(), List.of())) {
                if (m.name().equals(name) && m.accepts(argc)) return m.id();
            }
        }
        return null;
    }
}
