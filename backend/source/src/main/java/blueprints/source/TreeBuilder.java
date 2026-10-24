package blueprints.source;

import com.github.javaparser.JavaParser;
import com.github.javaparser.JavaToken;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.Position;
import com.github.javaparser.ast.Modifier;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.NodeList;
import com.github.javaparser.ast.body.AnnotationDeclaration;
import com.github.javaparser.ast.body.BodyDeclaration;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.EnumDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.RecordDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.nodeTypes.NodeWithTypeParameters;
import com.github.javaparser.ast.type.TypeParameter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;

/**
 * Дерево проекта для UI: пакеты → файлы → классы → поля/конструкторы/методы. Имена полей = контракт ProjectTree
 * (кроме ключевых слов Java: extendsText → extends, implementsTypes → implements, thrown → throws — переименовывает app).
 * Позиции заголовков (headerStart/headerEnd) — как у Monaco: line и column с 1, column в UTF-16 code units (так считает JavaParser).
 */
public final class TreeBuilder {
    public record Span(String file, int startLine, int endLine) {}

    /** Точка в тексте: line и column с 1, column — в UTF-16 code units. */
    public record Pos(int line, int column) {}

    /** span — объявление поля целиком; у компонент record — null. */
    public record Field(String name, String type, List<String> modifiers, Span span) {}

    /** type — как в коде, varargs — "String...". */
    public record Param(String name, String type) {}

    /**
     * complexity пока null (анализа нет), issueCount 0 — их подставляет app через {@link #withAnalysis}.
     * headerEnd — позиция «{» тела, у метода без тела — «;». returnType у конструктора null, typeParams без параметров — null.
     */
    public record Method(String id, String name, String signature, String complexity, int issueCount,
                         Span span, Span headerSpan, Pos headerStart, Pos headerEnd, List<String> annotations,
                         List<String> modifiers, String typeParams, String returnType, List<Param> params, List<String> thrown) {
        public Method withAnalysis(String complexity, int issueCount) {
            return new Method(id, name, signature, complexity, issueCount, span, headerSpan, headerStart, headerEnd, annotations,
                    modifiers, typeParams, returnType, params, thrown);
        }
    }

    /** fqn — через точки (pkg.Outer.Inner); headerEnd — позиция «{» тела; extendsText null, если нет. */
    public record ClassNode(String name, String kind, String fqn, Span span, Span headerSpan, Pos headerStart, Pos headerEnd,
                            List<String> annotations, List<String> modifiers, String typeParams, String extendsText,
                            List<String> implementsTypes, List<Field> fields, List<Method> constructors, List<Method> methods) {
        public ClassNode withMembers(List<Method> constructors, List<Method> methods) {
            return new ClassNode(name, kind, fqn, span, headerSpan, headerStart, headerEnd, annotations, modifiers, typeParams,
                    extendsText, implementsTypes, fields, constructors, methods);
        }
    }

    public record FileNode(String path, List<ClassNode> classes) {}
    public record PackageNode(String name, List<FileNode> files) {}

    private TreeBuilder() {}

    public static List<PackageNode> build(LoadedProject p) {
        JavaParser parser = new JavaParser(new ParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21));
        Map<String, List<FileNode>> byPkg = new TreeMap<>();
        for (SourceFile f : p.files()) {
            var pr = parser.parse(f.text());
            List<ClassNode> classes = new ArrayList<>();
            // файл, который JavaParser не разбирает (загружен как текст), — без классов и методов
            if (pr.isSuccessful() && pr.getResult().isPresent()) {
                for (TypeDeclaration<?> t : pr.getResult().get().getTypes()) addType(t, f, classes);
            }
            byPkg.computeIfAbsent(f.pkg(), k -> new ArrayList<>()).add(new FileNode(f.path(), classes));
        }
        List<PackageNode> out = new ArrayList<>();
        byPkg.forEach((n, fs) -> {
            fs.sort(Comparator.comparing(FileNode::path));
            out.add(new PackageNode(n, fs));
        });
        return out;
    }

    /** Класс, затем его вложенные (имя Outer$Inner); id метода: FQN.имя~индекс перегрузки с 0, конструктор — &lt;init&gt;. */
    private static void addType(TypeDeclaration<?> t, SourceFile f, List<ClassNode> out) {
        String bin = Names.binary(t);
        String fqn = Names.fqn(f.pkg(), bin);
        List<Field> fields = new ArrayList<>();
        if (t instanceof RecordDeclaration r) {
            r.getParameters().forEach(a -> fields.add(new Field(a.getNameAsString(), a.getTypeAsString(), List.of("private", "final"), null)));
        }
        t.getFields().forEach(fd -> fd.getVariables().forEach(v -> fields.add(new Field(
                v.getNameAsString(), v.getTypeAsString(), modifiers(fd.getModifiers()), span(fd, f)))));
        List<Method> ctors = new ArrayList<>();
        for (var c : t.getConstructors()) {
            ctors.add(method(fqn + ".<init>~" + ctors.size(), t.getNameAsString(), c, f));
        }
        Map<String, Integer> idx = new HashMap<>();
        List<Method> methods = new ArrayList<>();
        for (var m : t.getMethods()) {
            int i = idx.merge(m.getNameAsString(), 1, Integer::sum) - 1;
            methods.add(method(fqn + "." + m.getNameAsString() + "~" + i, m.getNameAsString(), m, f));
        }
        Pos start = pos(t.getBegin().orElse(null));
        Pos end = classBrace(t);
        String ext = null;
        List<String> impl = List.of();
        if (t instanceof ClassOrInterfaceDeclaration c) {
            ext = c.getExtendedTypes().isEmpty() ? null : c.getExtendedTypes().stream().map(TreeBuilder::text).collect(Collectors.joining(", "));
            impl = texts(c.getImplementedTypes());
        } else if (t instanceof EnumDeclaration e) {
            impl = texts(e.getImplementedTypes());
        } else if (t instanceof RecordDeclaration r) {
            impl = texts(r.getImplementedTypes());
        }
        String typeParams = t instanceof NodeWithTypeParameters<?> g ? typeParams(g.getTypeParameters()) : null;
        out.add(new ClassNode(bin, kind(t), Names.fqn(f.pkg(), bin.replace('$', '.')), span(t, f), headerSpan(f, start, end), start, end,
                annotations(t), modifiers(t.getModifiers()), typeParams, ext, impl, fields, ctors, methods));
        t.getMembers().forEach(m -> { if (m instanceof TypeDeclaration<?> n) addType(n, f, out); });
    }

    private static Method method(String id, String name, CallableDeclaration<?> c, SourceFile f) {
        Pos start = pos(c.getBegin().orElse(null));
        Pos end;
        String returnType = null;
        if (c instanceof MethodDeclaration md) {
            returnType = text(md.getType());
            // тело — «{», без тела (abstract, интерфейс, native) — завершающая «;»
            end = md.getBody().map(b -> pos(b.getBegin().orElse(null))).orElseGet(() -> pos(md.getEnd().orElse(null)));
        } else {
            end = pos(((ConstructorDeclaration) c).getBody().getBegin().orElse(null));
        }
        List<Param> params = c.getParameters().stream()
                .map(p -> new Param(p.getNameAsString(), text(p.getType()) + (p.isVarArgs() ? "..." : ""))).toList();
        return new Method(id, name, c.getDeclarationAsString(true, true, true), null, 0, span(c, f), headerSpan(f, start, end),
                start, end, annotations(c), modifiers(c.getModifiers()), typeParams(c.getTypeParameters()), returnType, params,
                texts(c.getThrownExceptions()));
    }

    /** Открывающая «{» тела класса: первая «{» вне скобок (аргументы аннотаций, компоненты record) в токенах объявления. */
    private static Pos classBrace(TypeDeclaration<?> t) {
        int depth = 0;
        for (JavaToken tok : t.getTokenRange().orElseThrow()) {
            String s = tok.getText();
            if (s.equals("(")) depth++;
            else if (s.equals(")")) depth--;
            else if (s.equals("{") && depth == 0) return tok.getRange().map(r -> new Pos(r.begin.line, r.begin.column)).orElse(null);
        }
        return null;
    }

    private static Pos pos(Position p) {
        return p == null ? null : new Pos(p.line, p.column);
    }

    private static Span span(Node n, SourceFile f) {
        int begin = n.getBegin().map(x -> x.line).orElse(1);
        return new Span(f.path(), begin, n.getEnd().map(x -> x.line).orElse(begin));
    }

    private static Span headerSpan(SourceFile f, Pos start, Pos end) {
        return start == null || end == null ? null : new Span(f.path(), start.line(), end.line());
    }

    private static List<String> annotations(BodyDeclaration<?> d) {
        return d.getAnnotations().stream().map(TreeBuilder::text).toList();
    }

    private static List<String> modifiers(NodeList<Modifier> ms) {
        return ms.stream().map(m -> m.getKeyword().asString()).toList();
    }

    private static List<String> texts(NodeList<? extends Node> ns) {
        return ns.stream().map(TreeBuilder::text).toList();
    }

    /** "&lt;A, B&gt;" текстом как в коде или null. */
    private static String typeParams(NodeList<TypeParameter> tps) {
        return tps.isEmpty() ? null : tps.stream().map(TreeBuilder::text).collect(Collectors.joining(", ", "<", ">"));
    }

    /** Исходный текст узла (токены), иначе печать JavaParser. */
    private static String text(Node n) {
        return n.getTokenRange().map(Object::toString).orElse(n.toString());
    }

    private static String kind(TypeDeclaration<?> t) {
        if (t instanceof EnumDeclaration) return "enum";
        if (t instanceof RecordDeclaration) return "record";
        if (t instanceof AnnotationDeclaration) return "interface";
        return ((ClassOrInterfaceDeclaration) t).isInterface() ? "interface" : "class";
    }
}
