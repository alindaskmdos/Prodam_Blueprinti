package blueprints.source;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.Modifier;
import com.github.javaparser.ast.body.AnnotationDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.EnumDeclaration;
import com.github.javaparser.ast.body.RecordDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Дерево проекта для UI: пакеты → файлы → классы → поля/конструкторы/методы. Имена полей = контракт ProjectTree. */
public final class TreeBuilder {
    public record Span(String file, int startLine, int endLine) {}
    public record Field(String name, String type, List<String> modifiers) {}
    /** complexity пока null (анализа нет), issueCount 0. */
    public record Method(String id, String name, String signature, String complexity, int issueCount) {}
    public record ClassNode(String name, String kind, Span span, List<Field> fields, List<Method> constructors, List<Method> methods) {}
    public record FileNode(String path, List<ClassNode> classes) {}
    public record PackageNode(String name, List<FileNode> files) {}

    private TreeBuilder() {}

    public static List<PackageNode> build(LoadedProject p) {
        JavaParser parser = new JavaParser(new ParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21));
        Map<String, List<FileNode>> byPkg = new TreeMap<>();
        for (SourceFile f : p.files()) {
            CompilationUnit cu = parser.parse(f.text()).getResult().orElseThrow();
            List<ClassNode> classes = new ArrayList<>();
            for (TypeDeclaration<?> t : cu.getTypes()) addType(t, f, classes);
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
            r.getParameters().forEach(a -> fields.add(new Field(a.getNameAsString(), a.getTypeAsString(), List.of("private", "final"))));
        }
        t.getFields().forEach(fd -> fd.getVariables().forEach(v -> fields.add(new Field(
                v.getNameAsString(), v.getTypeAsString(),
                fd.getModifiers().stream().map(m -> m.getKeyword().asString()).toList()))));
        List<Method> ctors = new ArrayList<>();
        for (var c : t.getConstructors()) {
            ctors.add(new Method(fqn + ".<init>~" + ctors.size(), t.getNameAsString(),
                    c.getDeclarationAsString(true, true, true), null, 0));
        }
        Map<String, Integer> idx = new HashMap<>();
        List<Method> methods = new ArrayList<>();
        for (var m : t.getMethods()) {
            int i = idx.merge(m.getNameAsString(), 1, Integer::sum) - 1;
            methods.add(new Method(fqn + "." + m.getNameAsString() + "~" + i, m.getNameAsString(),
                    m.getDeclarationAsString(true, true, true), null, 0));
        }
        int begin = t.getBegin().map(x -> x.line).orElse(1);
        int end = t.getEnd().map(x -> x.line).orElse(begin);
        out.add(new ClassNode(bin, kind(t), new Span(f.path(), begin, end), fields, ctors, methods));
        t.getMembers().forEach(m -> { if (m instanceof TypeDeclaration<?> n) addType(n, f, out); });
    }

    private static String kind(TypeDeclaration<?> t) {
        if (t instanceof EnumDeclaration) return "enum";
        if (t instanceof RecordDeclaration) return "record";
        if (t instanceof AnnotationDeclaration) return "interface";
        return ((ClassOrInterfaceDeclaration) t).isInterface() ? "interface" : "class";
    }
}
