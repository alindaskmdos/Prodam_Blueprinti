package blueprints.source;

import com.github.javaparser.ast.body.TypeDeclaration;

final class Names {
    private Names() {}

    /** Бинарное имя без пакета: Outer$Inner. */
    static String binary(TypeDeclaration<?> td) {
        String n = td.getNameAsString();
        return td.getParentNode().filter(p -> p instanceof TypeDeclaration)
                .map(p -> binary((TypeDeclaration<?>) p) + "$" + n).orElse(n);
    }

    static String fqn(String pkg, String binary) {
        return pkg.isEmpty() ? binary : pkg + "." + binary;
    }
}
