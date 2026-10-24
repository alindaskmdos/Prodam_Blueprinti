package blueprints.analysis;

import blueprints.analysis.ProjectAnalysis.TypeInfo;
import blueprints.model.Span;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.ImportDeclaration;
import com.github.javaparser.ast.Modifier;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.NodeList;
import com.github.javaparser.ast.body.AnnotationDeclaration;
import com.github.javaparser.ast.body.BodyDeclaration;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.EnumDeclaration;
import com.github.javaparser.ast.body.FieldDeclaration;
import com.github.javaparser.ast.body.InitializerDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.body.RecordDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.expr.AssignExpr;
import com.github.javaparser.ast.expr.CastExpr;
import com.github.javaparser.ast.expr.EnclosedExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.FieldAccessExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.expr.ThisExpr;
import com.github.javaparser.ast.nodeTypes.NodeWithTypeParameters;
import com.github.javaparser.ast.type.ArrayType;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.ast.type.Type;
import com.github.javaparser.ast.type.TypeParameter;
import com.github.javaparser.ast.type.WildcardType;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * UML-модель классов проекта (§14а.1): карточки классов и связи только между классами проекта.
 * Типы резолвятся по тексту (вложенные типы своего класса и внешних, импорт, свой пакет, импорт «*»), без Symbol Solver.
 * На пару from/to — одна связь самого сильного вида: extends/implements > composition > aggregation > association > dependency.
 * Поле: коллекция/массив/Map (по значению) класса проекта → aggregation «*»; объект, присвоенный через new → composition;
 * из параметра конструктора (и компонент record) → aggregation; иначе association «1». Использование в методе,
 * конструкторе или объявлении поля → dependency (via — первый по порядку член класса).
 */
public final class UmlModel {
    public record Field(String name, String type, List<String> modifiers) {}

    /** Метод или конструктор; id — как в дереве проекта ({@code FQN$Inner.имя~N}). */
    public record Member(String id, String name, String signature, List<String> modifiers) {}

    /** id — FQN через точки (вложенный — pkg.Outer.Inner); name — без пакета (Outer.Inner); typeParams — null, если нет. */
    public record Clazz(String id, String name, String kind, String pkg, String path, Span span, List<String> modifiers,
                        String typeParams, List<Field> fields, List<Member> constructors, List<Member> methods) {}

    /** multiplicity — "1"/"*" только у связей через поле, иначе null; via — поле или метод, null у extends/implements. */
    public record Relation(String from, String to, String kind, boolean heuristic, String multiplicity, String via) {}

    static final List<String> STRENGTH = List.of("dependency", "association", "aggregation", "composition", "implements", "extends");

    /** Коллекции, дающие связь к аргументу типа с кратностью «*»; Map-типы (имя на Map) — по значению. */
    static final Set<String> COLLECTIONS = Set.of("List", "ArrayList", "LinkedList", "Set", "HashSet", "LinkedHashSet",
            "TreeSet", "SortedSet", "NavigableSet", "EnumSet", "Collection", "Iterable", "Queue", "Deque", "ArrayDeque",
            "PriorityQueue", "Stack", "Vector", "CopyOnWriteArrayList", "CopyOnWriteArraySet", "BlockingQueue",
            "LinkedBlockingQueue", "ArrayBlockingQueue", "ConcurrentLinkedQueue", "SequencedCollection", "SequencedSet");

    private final List<Clazz> classes;
    private final List<Relation> relations;
    private final Map<String, Clazz> byId = new LinkedHashMap<>();
    private final Map<String, String> outer;

    private UmlModel(List<Clazz> classes, List<Relation> relations, Map<String, String> outer) {
        this.classes = List.copyOf(classes);
        this.relations = List.copyOf(relations);
        this.outer = outer;
        classes.forEach(c -> byId.put(c.id(), c));
    }

    public List<Clazz> classes() {
        return classes;
    }

    public List<Relation> relations() {
        return relations;
    }

    /** Класс по id (FQN через точки) или null. */
    public Clazz clazz(String id) {
        return byId.get(id);
    }

    /** a вложен в b или b в a (на любой глубине). */
    public boolean nested(String a, String b) {
        return encloses(a, b) || encloses(b, a);
    }

    private boolean encloses(String out, String in) {
        for (String o = outer.get(in); o != null; o = outer.get(o)) if (o.equals(out)) return true;
        return false;
    }

    static String dotted(String fqn) {
        return fqn.replace('$', '.');
    }

    static UmlModel build(ProjectAnalysis project) {
        List<TypeInfo> types = new ArrayList<>(project.types());
        types.sort(Comparator.comparing(TypeInfo::pkg).thenComparing(TypeInfo::path)); // как пакеты/файлы дерева проекта
        Resolver r = new Resolver(types);
        Map<String, String> outer = new LinkedHashMap<>();
        List<Clazz> classes = new ArrayList<>();
        Map<String, Relation> rels = new LinkedHashMap<>();
        for (TypeInfo t : types) {
            String id = dotted(t.fqn());
            t.decl().getParentNode().filter(p -> p instanceof TypeDeclaration<?>)
                    .ifPresent(p -> outer.put(id, r.idOf.get(p)));
            classes.add(card(t));
            relations(t.decl(), id, r, rels);
        }
        return new UmlModel(classes, new ArrayList<>(rels.values()), outer);
    }

    // ---- карточка ----

    private static Clazz card(TypeInfo t) {
        TypeDeclaration<?> td = t.decl();
        List<Field> fields = new ArrayList<>();
        if (td instanceof RecordDeclaration rd) {
            rd.getParameters().forEach(p -> fields.add(new Field(p.getNameAsString(), p.getTypeAsString(), List.of("private", "final"))));
        }
        td.getFields().forEach(fd -> fd.getVariables().forEach(v -> fields.add(new Field(v.getNameAsString(), v.getTypeAsString(),
                modifiers(fd.getModifiers())))));
        List<Member> ctors = new ArrayList<>();
        for (ConstructorDeclaration c : td.getConstructors()) {
            ctors.add(new Member(t.fqn() + ".<init>~" + ctors.size(), td.getNameAsString(), signature(c), modifiers(c.getModifiers())));
        }
        Map<String, Integer> idx = new LinkedHashMap<>();
        List<Member> methods = new ArrayList<>();
        for (var m : td.getMethods()) {
            int i = idx.merge(m.getNameAsString(), 1, Integer::sum) - 1;
            methods.add(new Member(t.fqn() + "." + m.getNameAsString() + "~" + i, m.getNameAsString(), signature(m),
                    modifiers(m.getModifiers())));
        }
        int begin = td.getBegin().map(p -> p.line).orElse(1);
        Span span = new Span(t.path(), begin, td.getEnd().map(p -> p.line).orElse(begin));
        String tp = td instanceof NodeWithTypeParameters<?> n ? typeParams(n.getTypeParameters()) : null;
        String name = dotted(t.fqn()).substring(t.pkg().isEmpty() ? 0 : t.pkg().length() + 1);
        return new Clazz(dotted(t.fqn()), name, kind(td), t.pkg(), t.path(), span, modifiers(td.getModifiers()), tp,
                fields, ctors, methods);
    }

    /** Объявленные модификаторы + заголовок без них ({@code public int merge()}); неявный abstract интерфейса не пишется. */
    static String signature(CallableDeclaration<?> c) {
        String head = c.getDeclarationAsString(false, true, true).strip();
        List<String> mods = modifiers(c.getModifiers());
        return mods.isEmpty() ? head : String.join(" ", mods) + " " + head;
    }

    static List<String> modifiers(NodeList<Modifier> ms) {
        return ms.stream().map(m -> m.getKeyword().asString()).toList();
    }

    /** "&lt;A, B&gt;" текстом как в коде или null. */
    static String typeParams(NodeList<TypeParameter> tps) {
        if (tps.isEmpty()) return null;
        return tps.stream().map(UmlModel::text).collect(Collectors.joining(", ", "<", ">"));
    }

    /** Исходный текст узла (токены), иначе печать JavaParser. */
    static String text(Node n) {
        return n.getTokenRange().map(Object::toString).orElse(n.toString());
    }

    static String kind(TypeDeclaration<?> t) {
        if (t instanceof EnumDeclaration) return "enum";
        if (t instanceof RecordDeclaration) return "record";
        if (t instanceof AnnotationDeclaration) return "interface";
        return ((ClassOrInterfaceDeclaration) t).isInterface() ? "interface" : "class";
    }

    // ---- связи ----

    private static void relations(TypeDeclaration<?> td, String from, Resolver r, Map<String, Relation> out) {
        if (td instanceof ClassOrInterfaceDeclaration c) {
            for (ClassOrInterfaceType e : c.getExtendedTypes()) add(out, from, r.resolve(e), "extends", null, null);
            for (ClassOrInterfaceType e : c.getImplementedTypes()) add(out, from, r.resolve(e), "implements", null, null);
        } else if (td instanceof RecordDeclaration rd) {
            for (ClassOrInterfaceType e : rd.getImplementedTypes()) add(out, from, r.resolve(e), "implements", null, null);
        } else if (td instanceof EnumDeclaration ed) {
            for (ClassOrInterfaceType e : ed.getImplementedTypes()) add(out, from, r.resolve(e), "implements", null, null);
        }
        if (td instanceof RecordDeclaration rd) {
            for (Parameter p : rd.getParameters()) {
                uses(p, r, to -> add(out, from, to, "dependency", null, p.getNameAsString()));
                Target t = r.target(p.getType());
                if (t != null) add(out, from, t.id(), "aggregation", t.many() ? "*" : "1", p.getNameAsString());
            }
        }
        for (BodyDeclaration<?> m : td.getMembers()) {
            if (m instanceof FieldDeclaration fd) {
                for (VariableDeclarator v : fd.getVariables()) {
                    uses(v, r, to -> add(out, from, to, "dependency", null, v.getNameAsString()));
                    Target t = r.target(v.getType());
                    if (t != null) {
                        add(out, from, t.id(), fieldKind(td, v, t.many()), t.many() ? "*" : "1", v.getNameAsString());
                    }
                }
            } else if (m instanceof CallableDeclaration<?> cd) {
                String via = cd instanceof ConstructorDeclaration ? td.getNameAsString() : cd.getNameAsString();
                uses(cd, r, to -> add(out, from, to, "dependency", null, via));
            } else if (m instanceof InitializerDeclaration init) {
                uses(init, r, to -> add(out, from, to, "dependency", null, null));
            }
        }
    }

    /** Коллекция — aggregation; присвоение new — composition; из параметра конструктора — aggregation; иначе association. */
    private static String fieldKind(TypeDeclaration<?> td, VariableDeclarator v, boolean many) {
        if (many) return "aggregation";
        if (v.getInitializer().map(UmlModel::unwrap).filter(e -> e instanceof ObjectCreationExpr).isPresent()) return "composition";
        String name = v.getNameAsString();
        boolean fromParam = false;
        for (AssignExpr a : td.findAll(AssignExpr.class)) {
            if (ownerType(a) != td || a.getOperator() != AssignExpr.Operator.ASSIGN || !targets(a.getTarget(), name)) continue;
            Expression value = unwrap(a.getValue());
            if (value instanceof ObjectCreationExpr) return "composition";
            if (value instanceof NameExpr ne) {
                ConstructorDeclaration ctor = a.findAncestor(ConstructorDeclaration.class).orElse(null);
                if (ctor != null && ctor.getParameterByName(ne.getNameAsString()).isPresent()) fromParam = true;
            }
        }
        return fromParam ? "aggregation" : "association";
    }

    private static boolean targets(Expression target, String field) {
        if (target instanceof NameExpr n) return n.getNameAsString().equals(field);
        return target instanceof FieldAccessExpr f && f.getScope() instanceof ThisExpr && f.getNameAsString().equals(field);
    }

    private static Expression unwrap(Expression e) {
        while (true) {
            if (e instanceof EnclosedExpr x) e = x.getInner();
            else if (e instanceof CastExpr x) e = x.getExpression();
            else return e;
        }
    }

    private static Node ownerType(Node n) {
        for (Node p = n.getParentNode().orElse(null); p != null; p = p.getParentNode().orElse(null)) {
            if (p instanceof TypeDeclaration<?>) return p;
        }
        return null;
    }

    /** Классы проекта, упомянутые в узле: типы (с аргументами) и статические обращения {@code Tier.parse(…)}. */
    private static void uses(Node root, Resolver r, java.util.function.Consumer<String> sink) {
        root.walk(n -> {
            if (n instanceof ClassOrInterfaceType c) {
                boolean isScope = c.getParentNode().filter(p -> p instanceof ClassOrInterfaceType pc
                        && pc.getScope().filter(s -> s == c).isPresent()).isPresent();
                if (!isScope) sink.accept(r.resolve(c));
            } else if (n instanceof NameExpr ne && isTypeScope(ne)) {
                sink.accept(r.resolve(ne.getNameAsString(), ne));
            }
        });
    }

    private static boolean isTypeScope(NameExpr ne) {
        String name = ne.getNameAsString();
        if (name.isEmpty() || !Character.isUpperCase(name.charAt(0))) return false;
        Node p = ne.getParentNode().orElse(null);
        if (p instanceof MethodCallExpr mc) return mc.getScope().filter(s -> s == ne).isPresent();
        return p instanceof FieldAccessExpr fa && fa.getScope() == ne;
    }

    private static void add(Map<String, Relation> out, String from, String to, String kind, String multiplicity, String via) {
        if (to == null || to.equals(from)) return;
        boolean heuristic = kind.equals("aggregation") || kind.equals("composition");
        Relation rel = new Relation(from, to, kind, heuristic, multiplicity, via);
        String key = from + "\n" + to;
        Relation old = out.get(key);
        if (old == null || STRENGTH.indexOf(kind) > STRENGTH.indexOf(old.kind())) out.put(key, rel);
    }

    record Target(String id, boolean many) {}

    /** Текстовый резолв имён типов в id классов проекта (FQN через точки). */
    static final class Resolver {
        final Map<String, TypeInfo> byId = new LinkedHashMap<>();
        final Map<Node, String> idOf = new IdentityHashMap<>();

        Resolver(List<TypeInfo> types) {
            for (TypeInfo t : types) {
                byId.put(dotted(t.fqn()), t);
                idOf.put(t.decl(), dotted(t.fqn()));
            }
        }

        String resolve(ClassOrInterfaceType c) {
            return resolve(c.getNameWithScope(), c);
        }

        /** Класс проекта, на который указывает поле/параметр типа: сам тип или элемент коллекции/массива/значение Map. */
        Target target(Type type) {
            if (type instanceof ArrayType a) {
                Target t = target(a.getComponentType());
                return t == null ? null : new Target(t.id(), true);
            }
            if (type instanceof WildcardType w) return w.getExtendedType().map(this::target).orElse(null);
            if (!(type instanceof ClassOrInterfaceType c)) return null;
            String id = resolve(c);
            if (id != null) return new Target(id, false);
            List<Type> args = c.getTypeArguments().map(List::copyOf).orElse(List.of());
            String n = c.getNameAsString();
            Type elem = null;
            if (n.endsWith("Map") && args.size() == 2) elem = args.get(1);
            else if (COLLECTIONS.contains(n) && args.size() == 1) elem = args.get(0);
            if (elem == null) return null;
            Target t = target(elem);
            return t == null ? null : new Target(t.id(), true);
        }

        /** name — простое или квалифицированное имя ({@code Validator.Issue}, {@code com.demo.model.Order}); ctx — место использования. */
        String resolve(String name, Node ctx) {
            String[] seg = name.split("\\.");
            String id = simple(seg[0], ctx);
            if (id != null) {
                for (int i = 1; i < seg.length; i++) {
                    id = id + "." + seg[i];
                    if (!byId.containsKey(id)) return null;
                }
                return id;
            }
            return seg.length > 1 && byId.containsKey(name) ? name : null;
        }

        private String simple(String simple, Node ctx) {
            for (Node n = ctx; n != null; n = n.getParentNode().orElse(null)) {
                if (n instanceof NodeWithTypeParameters<?> g
                        && g.getTypeParameters().stream().anyMatch(tp -> tp.getNameAsString().equals(simple))) return null;
                String id = idOf.get(n);
                if (id == null) continue;
                if (((TypeDeclaration<?>) n).getNameAsString().equals(simple)) return id;
                if (byId.containsKey(id + "." + simple)) return id + "." + simple;
            }
            CompilationUnit cu = ctx.findCompilationUnit().orElse(null);
            if (cu == null) return null;
            for (ImportDeclaration im : cu.getImports()) {
                if (!im.isAsterisk() && !im.isStatic() && im.getName().getIdentifier().equals(simple)) {
                    return byId.containsKey(im.getNameAsString()) ? im.getNameAsString() : null; // импорт не из проекта затеняет
                }
            }
            String pkg = cu.getPackageDeclaration().map(p -> p.getNameAsString()).orElse("");
            String same = pkg.isEmpty() ? simple : pkg + "." + simple;
            if (byId.containsKey(same)) return same;
            for (ImportDeclaration im : cu.getImports()) {
                String cand = im.getNameAsString() + "." + simple;
                if (im.isAsterisk() && !im.isStatic() && byId.containsKey(cand)) return cand;
            }
            return null;
        }
    }
}
