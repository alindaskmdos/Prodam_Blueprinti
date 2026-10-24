package blueprints.fixes;

import blueprints.source.SourceFile;
import com.github.javaparser.Position;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.ImportDeclaration;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.TypeDeclaration;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Общие для фиксов операции над текстом: файлы проекта → SourceFile, позиции JavaParser → смещения, точечные правки. */
final class FixText {
    private static final Pattern PACKAGE = Pattern.compile("^\\s*package\\s+([\\w.]+)\\s*;", Pattern.MULTILINE);

    private FixText() {}

    record Edit(int start, int end, String text) {}

    /** Применяет правки (диапазоны не пересекаются) с конца файла, чтобы смещения не съезжали. */
    static String applyEdits(String text, List<Edit> edits) {
        List<Edit> sorted = new ArrayList<>(edits);
        sorted.sort(Comparator.comparingInt(Edit::start).reversed());
        StringBuilder out = new StringBuilder(text);
        for (Edit e : sorted) out.replace(e.start(), e.end(), e.text());
        return out.toString();
    }

    /** Исходники программы для анализа: все .java вне tests/. */
    static List<SourceFile> sources(Map<String, String> files) {
        List<SourceFile> out = new ArrayList<>();
        files.forEach((path, text) -> {
            String p = path.replace('\\', '/');
            if (!p.endsWith(".java") || p.startsWith("tests/")) return;
            Matcher pk = PACKAGE.matcher(text);
            out.add(new SourceFile(path, pk.find() ? pk.group(1) : "", text.getBytes(StandardCharsets.UTF_8)));
        });
        return out;
    }

    static String newline(String text) {
        return text.contains("\r\n") ? "\r\n" : "\n";
    }

    /** Отступ строки, на которой начинается узел, если перед ним только пробелы; иначе null. */
    static String indent(String text, Node n) {
        int at = start(text, n), from = at;
        while (from > 0 && text.charAt(from - 1) != '\n' && text.charAt(from - 1) != '\r') from--;
        String ind = text.substring(from, at);
        return ind.isBlank() ? ind : null;
    }

    static String slice(String text, Node n) {
        return text.substring(start(text, n), end(text, n));
    }

    static int start(String text, Node n) {
        return offset(text, n.getBegin().orElseThrow());
    }

    /** Смещение после последнего символа узла (конец в JavaParser включительный). */
    static int end(String text, Node n) {
        return offset(text, n.getEnd().orElseThrow()) + 1;
    }

    /** Строка/колонка JavaParser (с 1; таб = 1 колонка; \r\n, \r, \n — перевод строки) → смещение в тексте. */
    static int offset(String text, Position p) {
        int i = 0;
        for (int line = 1; line < p.line; line++) {
            while (text.charAt(i) != '\n' && text.charAt(i) != '\r') i++;
            i += text.startsWith("\r\n", i) ? 2 : 1;
        }
        return i + p.column - 1;
    }

    /**
     * Импорты {@code java.util.<name>}, которых нет (после последнего импорта, иначе после package, иначе в начало файла);
     * null — имя занято другим типом (свой тип в файле или чужой импорт).
     */
    static List<Edit> importEdits(CompilationUnit cu, String text, List<String> names) {
        String nl = newline(text);
        StringBuilder imports = new StringBuilder();
        for (String name : names) {
            Boolean has = imported(cu, name);
            if (has == null) return null;
            if (!has) imports.append(nl).append("import java.util.").append(name).append(';');
        }
        if (imports.isEmpty()) return List.of();
        Optional<? extends Node> anchor = cu.getImports().isNonEmpty()
                ? Optional.of(cu.getImports().getLast().orElseThrow()) : cu.getPackageDeclaration();
        if (anchor.isPresent()) return List.of(new Edit(end(text, anchor.get()), end(text, anchor.get()), imports.toString()));
        return List.of(new Edit(0, 0, imports.substring(nl.length()) + nl));
    }

    /** TRUE — имя java.util уже доступно, FALSE — нужен импорт, null — имя занято другим типом. */
    private static Boolean imported(CompilationUnit cu, String name) {
        if (cu.findFirst(Node.class, d -> d instanceof TypeDeclaration<?> td && td.getNameAsString().equals(name)).isPresent()) return null;
        boolean has = false;
        for (ImportDeclaration i : cu.getImports()) {
            if (i.isStatic()) continue;
            String n = i.getNameAsString();
            if (i.isAsterisk() ? n.equals("java.util") : n.equals("java.util." + name)) has = true;
            else if (!i.isAsterisk() && n.endsWith("." + name)) return null;
        }
        return has;
    }
}
