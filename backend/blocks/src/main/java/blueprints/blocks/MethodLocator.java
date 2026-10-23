package blueprints.blocks;

import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import java.util.List;
import java.util.Optional;

/**
 * Метод по id дерева проекта (как в {@code source.TreeBuilder}): {@code FQN.имя~N} — N-я перегрузка имени в порядке
 * объявления, {@code FQN.<init>~N} — N-й конструктор; вложенные типы — {@code Outer$Inner}. Локальные/анонимные — не ищутся.
 */
public final class MethodLocator {
    private MethodLocator() {}

    public static Optional<CallableDeclaration<?>> find(CompilationUnit cu, String methodId) {
        int tilde = methodId.lastIndexOf('~');
        int dot = methodId.lastIndexOf('.', tilde < 0 ? methodId.length() : tilde);
        if (tilde < 0 || dot < 0) return Optional.empty();
        String fqn = methodId.substring(0, dot);
        String name = methodId.substring(dot + 1, tilde);
        int n;
        try {
            n = Integer.parseInt(methodId.substring(tilde + 1));
        } catch (NumberFormatException e) {
            return Optional.empty();
        }
        String pkg = cu.getPackageDeclaration().map(p -> p.getNameAsString()).orElse("");
        for (TypeDeclaration<?> t : cu.findAll(TypeDeclaration.class)) {
            if (!t.isTopLevelType() && !t.isNestedType()) continue;
            String bin = binary(t);
            if (!fqn.equals(pkg.isEmpty() ? bin : pkg + "." + bin)) continue;
            List<? extends CallableDeclaration<?>> list = name.equals("<init>") ? t.getConstructors()
                    : t.getMethodsByName(name);
            return n >= 0 && n < list.size() ? Optional.of(list.get(n)) : Optional.empty();
        }
        return Optional.empty();
    }

    /** Бинарное имя без пакета: Outer$Inner. */
    static String binary(TypeDeclaration<?> td) {
        String n = td.getNameAsString();
        return td.getParentNode().filter(p -> p instanceof TypeDeclaration)
                .map(p -> binary((TypeDeclaration<?>) p) + "$" + n).orElse(n);
    }
}
