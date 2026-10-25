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
import com.github.javaparser.ast.body.FieldDeclaration;
import com.github.javaparser.ast.body.InitializerDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.comments.Comment;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Ответ модели «метод целиком» → новый текст файла: заменяется только диапазон объявления метода (остальное байт в байт),
 * новые вспомогательные члены из ответа вставляются сразу после него, недостающие import дописываются после последнего
 * импорта. Ответ может быть в ограде ```java, телом класса или целым файлом. Результат обязан разбираться.
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

    /** Член класса из ответа: разобранное объявление и его текст (без отступа). */
    record Member(BodyDeclaration<?> decl, String text) {}

    /** imports — строки «import …;» ответа, members — члены класса из ответа (метод и, возможно, вспомогательные). */
    record Reply(List<String> imports, List<Member> members) {
        /** Сколько раз HashMap/HashSet (не Linked) встречаются в членах, которые реально встанут на место {@code method}. */
        int hashCollections(CallableDeclaration<?> method) {
            return count(String.join("\n", split(method, this).stream().map(Member::text).toList()));
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

    /**
     * Первый блок ```…``` (иначе весь ответ). Целый файл/класс — берутся его import и члены первого типа; иначе ведущие
     * import — imports, остальное разбирается как тело класса (метод и, возможно, вспомогательные члены).
     */
    static Reply parse(String reply) {
        Matcher f = FENCE.matcher(reply);
        String code = f.find() ? f.group(1) : reply;
        ParseResult<CompilationUnit> file = parser().parse(code);
        if (file.isSuccessful() && !file.getResult().orElseThrow().getTypes().isEmpty()) {
            CompilationUnit cu = file.getResult().orElseThrow();
            List<String> imports = cu.getImports().stream().map(d -> d.toString().strip()).toList();
            return new Reply(imports, members(code, cu.getType(0).getMembers()));
        }
        List<String> lines = code.lines().toList();
        List<String> imports = new ArrayList<>();
        int i = 0;
        for (; i < lines.size(); i++) {
            String l = lines.get(i);
            if (IMPORT.matcher(l).matches()) imports.add(l.strip());
            else if (!l.isBlank()) break;
        }
        String wrapped = "class __X {\n" + String.join("\n", lines.subList(i, lines.size())) + "\n}\n";
        ParseResult<CompilationUnit> r = parser().parse(wrapped);
        if (!r.isSuccessful()) {
            throw new BadReply("ответ ИИ не разбирается как метод Java"
                    + r.getProblems().stream().findFirst().map(p -> ": " + p.getMessage()).orElse(""));
        }
        return new Reply(imports, members(wrapped, r.getResult().orElseThrow().getType(0).getMembers()));
    }

    private static List<Member> members(String code, List<BodyDeclaration<?>> decls) {
        return decls.stream().map(d -> new Member(d, dedent(slice(code, d).lines().toList()))).toList();
    }

    /** Ключи совпадения с членами класса: метод — имя/арность, поле — имя каждой переменной, тип — имя. */
    private static List<String> keys(BodyDeclaration<?> d) {
        if (d instanceof CallableDeclaration<?> c) return List.of(c.getNameAsString() + "(" + c.getParameters().size() + ")");
        if (d instanceof FieldDeclaration fd) return fd.getVariables().stream().map(v -> v.getNameAsString()).toList();
        if (d instanceof TypeDeclaration<?> t) return List.of("class " + t.getNameAsString());
        return List.of();
    }

    /** Объявление без комментариев — для сравнения «член не изменился». */
    private static Node bare(Node n) {
        Node c = n.clone();
        c.getAllContainedComments().forEach(Comment::remove);
        c.removeComment();
        return c;
    }

    /**
     * Целевой метод (то же имя, при нескольких — та же арность) и новые члены для вставки после него. Член, совпавший
     * по ключу с существующим, пропускается, если не изменён, иначе — отказ.
     */
    static List<Member> split(CallableDeclaration<?> method, Reply reply) {
        String name = method.getNameAsString();
        List<Member> named = reply.members().stream()
                .filter(m -> m.decl() instanceof CallableDeclaration<?> c && c.getNameAsString().equals(name)).toList();
        if (named.isEmpty()) throw new BadReply("ответ ИИ не содержит метод " + name);
        int arity = method.getParameters().size();
        Member target = named.stream()
                .filter(m -> ((CallableDeclaration<?>) m.decl()).getParameters().size() == arity)
                .findFirst().orElseThrow(() -> new BadReply("ИИ изменил число параметров метода " + name
                        + " (было " + arity + ") — правка отклонена"));
        Map<String, BodyDeclaration<?>> existing = new LinkedHashMap<>();
        List<Node> initializers = new ArrayList<>();
        for (Node n : method.getParentNode().orElseThrow().getChildNodes()) {
            if (n instanceof BodyDeclaration<?> b && n != method) for (String k : keys(b)) existing.put(k, b);
            if (n instanceof InitializerDeclaration) initializers.add(bare(n));
        }
        String own = keys(method).get(0);
        List<Member> out = new ArrayList<>();
        out.add(target);
        for (Member m : reply.members()) {
            if (m == target) continue;
            if (m.decl() instanceof InitializerDeclaration) {
                if (initializers.contains(bare(m.decl()))) continue;
                throw new BadReply("ИИ добавил или изменил блок инициализации класса — правка отклонена");
            }
            String clash = keys(m.decl()).stream()
                    .filter(k -> existing.containsKey(k) || k.equals(own)).findFirst().orElse(null);
            if (clash == null) out.add(m);
            else if (existing.get(clash) == null || !bare(existing.get(clash)).equals(bare(m.decl()))) {
                throw new BadReply((m.decl() instanceof CallableDeclaration<?> ? "ИИ изменил другой метод " : "ИИ изменил существующий член класса ")
                        + clash + " — правка отклонена");
            }
        }
        return out;
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
        for (Member m : split(method, reply)) {
            if (!body.isEmpty()) body.append(nl).append(nl).append(indent);
            boolean first = true;
            for (String line : m.text().split("\n", -1)) {
                if (!first) body.append(nl).append(line.isBlank() ? "" : indent);
                body.append(line.isBlank() ? "" : line);
                first = false;
            }
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
