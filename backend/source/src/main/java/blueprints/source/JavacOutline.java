package blueprints.source;

import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.Tree;
import com.sun.source.util.JavacTask;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import javax.lang.model.element.Modifier;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.ToolProvider;

/**
 * Запасной разбор javac для файлов, которые JavaParser не понимает (локальные enum/interface — пробел JavaParser 3.26–3.28).
 * Только синтаксис (без компиляции): пакет, top-level типы, классы с main. Пусто — javac тоже видит ошибку или javac нет.
 */
final class JavacOutline {
    record Outline(String pkg, List<String> topLevel, List<String> mainBinaries) {}

    private JavacOutline() {}

    static Optional<Outline> parse(String path, String text) {
        JavaCompiler jc = ToolProvider.getSystemJavaCompiler();
        if (jc == null) return Optional.empty();
        JavaFileObject fo = new SimpleJavaFileObject(URI.create("string:///" + path.replace(' ', '_')), JavaFileObject.Kind.SOURCE) {
            @Override
            public CharSequence getCharContent(boolean ignoreEncodingErrors) {
                return text;
            }
        };
        DiagnosticCollector<JavaFileObject> diag = new DiagnosticCollector<>();
        try {
            JavacTask task = (JavacTask) jc.getTask(null, null, diag, List.of("--release", "21", "-proc:none"), null, List.of(fo));
            List<CompilationUnitTree> units = new ArrayList<>();
            task.parse().forEach(units::add);
            boolean errors = diag.getDiagnostics().stream().anyMatch(d -> d.getKind() == javax.tools.Diagnostic.Kind.ERROR);
            if (errors || units.size() != 1) return Optional.empty();
            CompilationUnitTree cu = units.get(0);
            String pkg = cu.getPackageName() == null ? "" : cu.getPackageName().toString();
            List<String> top = new ArrayList<>(), mains = new ArrayList<>();
            for (Tree t : cu.getTypeDecls()) {
                if (t instanceof ClassTree c) {
                    top.add(c.getSimpleName().toString());
                    collectMains(c, c.getSimpleName().toString(), mains);
                }
            }
            return Optional.of(new Outline(pkg, top, mains));
        } catch (RuntimeException | java.io.IOException e) {
            return Optional.empty();
        }
    }

    /** Члены-типы (не локальные): Outer$Inner; main — static, один параметр. */
    private static void collectMains(ClassTree c, String bin, List<String> out) {
        for (Tree m : c.getMembers()) {
            if (m instanceof MethodTree mt && mt.getName().contentEquals("main")
                    && mt.getModifiers().getFlags().contains(Modifier.STATIC) && mt.getParameters().size() == 1) {
                if (!out.contains(bin)) out.add(bin);
            } else if (m instanceof ClassTree nested) {
                collectMains(nested, bin + "$" + nested.getSimpleName(), out);
            }
        }
    }
}
