package blueprints.ai;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParseResult;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.Position;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.ImportDeclaration;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.BodyDeclaration;
import com.github.javaparser.ast.body.CallableDeclaration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Ответ модели «метод целиком» → новый текст файла: заменяется только диапазон объявления метода (остальное байт в байт),
 * недостающие import из начала ответа дописываются после последнего импорта. Результат обязан разбираться.
 */
public final class MethodPatch {
    private static final Pattern FENCE = Pattern.compile("```[\\w+-]*[ \\t]*\\R(.*?)```", Pattern.DOTALL);
    private static final Pattern IMPORT = Pattern.compile("\\s*import\\s+(static\\s+)?([\\w.]+?)(\\.\\*)?\\s*;\\s*");
    private static final Pattern HASH = Pattern.compile("\\bHash(Map|Set)\\b");

    private MethodPatch() {}

    /** Ответ модели не разобрался как метод Java (в app — 422 PARSE_ERROR). */
    public static final class BadReply extends RuntimeException {
        BadReply(String message) {
            super(message);
        }
    }

    /** imports — строки «import …;» из начала ответа, member — текст метода. */
    record Reply(List<String> imports, String member) {
        /** Сколько раз встречаются HashMap/HashSet (не Linked). */
        int hashCollections() {
            return count(String.join("\n", imports) + "\n" + member);
        }
    }

    static JavaParser parser() {
        return new JavaParser(new ParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21));
    }

    static int count(String code) {
        Matcher m = HASH.matcher(code);
        int n = 0;
        while (m.find()) n++;
        return n;
    }

    /** Первый блок ```…``` (иначе весь ответ): ведущие import и пустые строки — imports, остальное — один метод. */
    static Reply parse(String reply) {
        Matcher f = FENCE.matcher(reply);
        List<String> lines = (f.find() ? f.group(1) : reply).lines().toList();
        List<String> imports = new ArrayList<>();
        int i = 0;
        for (; i < lines.size(); i++) {
            String l = lines.get(i);
            if (IMPORT.matcher(l).matches()) imports.add(l.strip());
            else if (!l.isBlank()) break;
        }
        String member = dedent(lines.subList(i, lines.size()));
        ParseResult<BodyDeclaration<?>> r = parser().parseBodyDeclaration(member);
        if (!r.isSuccessful() || !(r.getResult().orElseThrow() instanceof CallableDeclaration<?>)) {
            throw new BadReply("ответ ИИ не разбирается как метод Java"
                    + r.getProblems().stream().findFirst().map(p -> ": " + p.getMessage()).orElse(""));
        }
        return new Reply(imports, member);
    }

    /** Текст объявления метода в файле. */
    static String slice(String text, Node n) {
        return text.substring(start(text, n), end(text, n));
    }

    /** Новый текст файла: метод {@code method} (из разбора {@code text}) заменён на {@code reply}. */
    static String apply(String text, CallableDeclaration<?> method, Reply reply) {
        String nl = text.contains("\r\n") ? "\r\n" : "\n";
        int start = start(text, method), end = end(text, method);
        int from = start;
        while (from > 0 && text.charAt(from - 1) != '\n' && text.charAt(from - 1) != '\r') from--;
        String indent = text.substring(from, start).isBlank() ? text.substring(from, start) : "";
        StringBuilder body = new StringBuilder();
        for (String line : reply.member().split("\n", -1)) {
            if (!body.isEmpty()) body.append(nl).append(line.isBlank() ? "" : indent);
            body.append(line.isBlank() ? "" : line);
        }
        String out = text.substring(0, start) + body + text.substring(end);

        CompilationUnit cu = method.findCompilationUnit().orElseThrow();
        StringBuilder imports = new StringBuilder();
        for (String imp : reply.imports()) {
            if (!imported(cu, imp) && imports.indexOf(imp) < 0) imports.append(nl).append(imp);
        }
        if (!imports.isEmpty()) {
            Optional<? extends Node> anchor = cu.getImports().isNonEmpty()
                    ? cu.getImports().getLast() : cu.getPackageDeclaration();
            out = anchor.isPresent()
                    ? out.substring(0, end(text, anchor.get())) + imports + out.substring(end(text, anchor.get()))
                    : imports.substring(nl.length()) + nl + out;
        }
        ParseResult<CompilationUnit> check = parser().parse(out);
        if (!check.isSuccessful()) {
            throw new BadReply("после правки ИИ файл не разбирается"
                    + check.getProblems().stream().findFirst().map(p -> ": " + p.getMessage()).orElse(""));
        }
        return out;
    }

    /** Импорт уже есть точно или покрыт «.*» того же пакета. */
    private static boolean imported(CompilationUnit cu, String imp) {
        Matcher m = IMPORT.matcher(imp);
        if (!m.matches()) return false;
        boolean isStatic = m.group(1) != null;
        String name = m.group(2);
        boolean asterisk = m.group(3) != null;
        for (ImportDeclaration d : cu.getImports()) {
            if (d.isStatic() != isStatic) continue;
            String n = d.getNameAsString();
            if (d.isAsterisk() == asterisk && n.equals(name)) return true;
            if (d.isAsterisk() && !asterisk && name.startsWith(n + ".") && name.indexOf('.', n.length() + 1) < 0) return true;
        }
        return false;
    }

    /**
     * Отступ метода — по последней строке («}»): он снимается со всех строк, у первой — весь её отступ (модель часто
     * возвращает метод как вырезку из файла: первая строка без отступа, остальные с ним). Хвостовые пустые строки — прочь.
     */
    private static String dedent(List<String> lines) {
        List<String> out = new ArrayList<>(lines.stream().map(String::stripTrailing).toList());
        while (!out.isEmpty() && out.get(out.size() - 1).isEmpty()) out.remove(out.size() - 1);
        if (out.isEmpty()) return "";
        int base = indentOf(out.get(out.size() - 1));
        for (int i = 0; i < out.size(); i++) {
            String l = out.get(i);
            out.set(i, i == 0 ? l.stripLeading() : l.substring(Math.min(base, indentOf(l))));
        }
        return String.join("\n", out);
    }

    private static int indentOf(String l) {
        return l.length() - l.stripLeading().length();
    }

    private static int start(String text, Node n) {
        return offset(text, n.getBegin().orElseThrow());
    }

    /** Смещение после последнего символа узла (конец в JavaParser включительный). */
    private static int end(String text, Node n) {
        return offset(text, n.getEnd().orElseThrow()) + 1;
    }

    /** Строка/колонка JavaParser (с 1; \r\n, \r, \n — перевод строки) → смещение в тексте. */
    private static int offset(String text, Position p) {
        int i = 0;
        for (int line = 1; line < p.line; line++) {
            while (text.charAt(i) != '\n' && text.charAt(i) != '\r') i++;
            i += text.startsWith("\r\n", i) ? 2 : 1;
        }
        return i + p.column - 1;
    }
}
