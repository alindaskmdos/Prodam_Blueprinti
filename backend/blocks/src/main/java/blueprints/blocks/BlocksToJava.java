package blueprints.blocks;

import blueprints.model.Block;
import com.github.javaparser.JavaParser;
import com.github.javaparser.JavaToken;
import com.github.javaparser.ParseResult;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.Position;
import com.github.javaparser.ast.comments.Comment;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;

/**
 * Дерево {@link Block} метода -> Java (§5 ТЗ). Источник правды — текст: {@link #replaceMethod} подменяет в тексте файла
 * только тело (и заголовок, если изменилась signature) одного метода, все остальные байты файла не трогаются.
 * Неизменённое дерево возвращает исходный текст как есть.
 */
public final class BlocksToJava {

    /** Отступ тела: base — отступ строки заголовка метода, step — один уровень вложенности; eol — перевод строки файла. */
    public record Style(String base, String step, String eol) {
        public static final Style DEFAULT = new Style("", "    ", "\n");
    }

    private final Style style;
    /** Исходный вид комментариев метода по тексту блока (content.strip()), в порядке появления. */
    private final Map<String, ArrayDeque<String>> originals;
    private final StringBuilder out = new StringBuilder();

    private BlocksToJava(Style style, Map<String, ArrayDeque<String>> originals) {
        this.style = style;
        this.originals = originals;
    }

    /** Тело метода текстом "{ ... }": первая строка без отступа, закрывающая скобка — с отступом base. */
    public static String body(Block method, Style style) {
        return body(method, style, Map.of());
    }

    private static String body(Block method, Style style, Map<String, ArrayDeque<String>> originals) {
        BlocksToJava g = new BlocksToJava(style, originals);
        g.out.append('{').append(style.eol());
        g.seq(method.slots().getOrDefault("body", List.of()), 1);
        g.out.append(style.base()).append('}');
        return g.out.toString();
    }

    /**
     * Новый текст файла, где метод methodId (формат {@code Class.method~N}, как в дереве проекта) заменён деревом tree.
     * Неизменённое дерево (по kind/fields/slots) — исходный текст байт в байт. Изменилась только signature — меняется заголовок.
     *
     * @throws IllegalArgumentException файл не разбирается, метода нет, у метода без тела непустое дерево
     */
    public static String replaceMethod(String fileText, String methodId, Block tree) {
        ParseResult<CompilationUnit> pr = new JavaParser(new ParserConfiguration()
                .setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21)).parse(fileText);
        CompilationUnit cu = pr.getResult().filter(x -> pr.isSuccessful())
                .orElseThrow(() -> new IllegalArgumentException("файл не разбирается: " + pr.getProblems()));
        CallableDeclaration<?> decl = MethodLocator.find(cu, methodId)
                .orElseThrow(() -> new IllegalArgumentException("метод не найден: " + methodId));
        return replaceMethod(fileText, decl, tree);
    }

    /** То же для уже найденного метода; decl — из разбора именно fileText. */
    public static String replaceMethod(String fileText, CallableDeclaration<?> decl, Block tree) {
        Block current = AstToBlocks.convert(decl, "m", "");
        if (tree.fields().get("signature") == null) {
            // фронт может не прислать signature — значит, заголовок не менялся
            Map<String, String> f = new LinkedHashMap<>(tree.fields());
            f.put("signature", current.fields().get("signature"));
            tree = new Block(tree.id(), tree.kind(), f, tree.slots(), tree.span(), tree.issues(), tree.collapsed());
        }
        if (sameTree(current, tree)) return fileText;
        return splice(fileText, decl, tree, current);
    }

    /** Всегда генерирует тело заново (без проверки на неизменность); current — дерево decl. */
    static String splice(String fileText, CallableDeclaration<?> decl, Block tree, Block current) {
        BlockStmt body = decl instanceof MethodDeclaration m ? m.getBody().orElse(null)
                : ((ConstructorDeclaration) decl).getBody();
        String eol = fileText.contains("\r\n") ? "\r\n" : "\n";
        String newSig = Objects.requireNonNullElse(tree.fields().get("signature"), current.fields().get("signature"));
        boolean sigChanged = !newSig.equals(current.fields().get("signature"));
        JavaToken declBegin = decl.getTokenRange().orElseThrow().getBegin();
        int declStart = offset(declBegin);
        if (body == null) {
            if (!tree.slots().getOrDefault("body", List.of()).isEmpty()) {
                throw new IllegalArgumentException("у метода нет тела: " + current.fields().get("signature"));
            }
            int end = offset(decl.getTokenRange().orElseThrow().getEnd()); // ';' после заголовка
            return fileText.substring(0, declStart) + newSig + fileText.substring(end);
        }
        Style st = style(fileText, declStart, body, eol);
        int bodyStart = offset(body.getTokenRange().orElseThrow().getBegin());
        JavaToken last = body.getTokenRange().orElseThrow().getEnd();
        int bodyEnd = offset(last) + last.getText().length();
        int from = sigChanged ? declStart : bodyStart;
        String head = sigChanged ? newSig + " " : "";
        return fileText.substring(0, from) + head + body(tree, st, originals(decl)) + fileText.substring(bodyEnd);
    }

    /** Совпадают ли деревья по смыслу: kind, fields, slots (id, span, issues, collapsed не важны). */
    public static boolean sameTree(Block a, Block b) {
        if (!a.kind().equals(b.kind()) || !a.fields().equals(b.fields())) return false;
        Map<String, List<Block>> sa = a.slots(), sb = b.slots();
        List<String> names = new ArrayList<>(sa.keySet());
        sb.keySet().forEach(k -> { if (!names.contains(k)) names.add(k); });
        for (String n : names) {
            List<Block> la = sa.getOrDefault(n, List.of()), lb = sb.getOrDefault(n, List.of());
            if (la.size() != lb.size()) return false;
            for (int i = 0; i < la.size(); i++) if (!sameTree(la.get(i), lb.get(i))) return false;
        }
        return true;
    }

    /**
     * Комментарии тела как в исходнике ({@code //}, {@code /* *\/}, {@code /** *\/} с текстом без изменений):
     * блок comment с тем же текстом выводится ровно в исходном виде. Только комментарии, ставшие блоками comment:
     * совпавший по тексту комментарий из выражения или raw не делает новый блок «исходным» (иначе \\u-escape в нём прошёл бы без проверки).
     */
    private static Map<String, ArrayDeque<String>> originals(CallableDeclaration<?> decl) {
        Map<Position, Comment> byBegin = new TreeMap<>();
        for (Comment c : AstToBlocks.blockComments(decl)) c.getRange().ifPresent(r -> byBegin.putIfAbsent(r.begin, c));
        Map<String, ArrayDeque<String>> out = new LinkedHashMap<>();
        for (Comment c : byBegin.values()) {
            out.computeIfAbsent(c.getContent().strip(), k -> new ArrayDeque<>()).add(c.getHeader() + c.getContent() + c.getFooter());
        }
        return out;
    }

    // ---- позиции в тексте ----

    /** Смещение токена в разобранном тексте: сумма длин всех предыдущих токенов (пробелы и комментарии тоже токены). */
    private static int offset(JavaToken t) {
        int n = 0;
        for (JavaToken p = t.getPreviousToken().orElse(null); p != null; p = p.getPreviousToken().orElse(null)) {
            n += p.getText().length();
        }
        return n;
    }

    /** base — отступ строки заголовка; step — из первого оператора тела, иначе таб/4 пробела. */
    private static Style style(String text, int declStart, BlockStmt body, String eol) {
        String base = indentOfLine(text, declStart);
        String step = base.contains("\t") ? "\t" : "    ";
        if (!body.getStatements().isEmpty()) {
            String inner = indentOfLine(text, offset(body.getStatement(0).getTokenRange().orElseThrow().getBegin()));
            if (inner.length() > base.length() && inner.startsWith(base)) step = inner.substring(base.length());
        }
        return new Style(base, step, eol);
    }

    private static String indentOfLine(String text, int pos) {
        int ls = Math.max(text.lastIndexOf('\n', pos - 1), text.lastIndexOf('\r', pos - 1)) + 1;
        int i = ls;
        while (i < text.length() && (text.charAt(i) == ' ' || text.charAt(i) == '\t')) i++;
        return text.substring(ls, Math.min(i, pos));
    }

    // ---- генерация ----

    private String ind(int depth) {
        return style.base() + style.step().repeat(depth);
    }

    private void line(int depth, String s) {
        out.append(ind(depth)).append(s).append(style.eol());
    }

    private void seq(List<Block> blocks, int depth) {
        for (Block b : blocks) block(b, depth);
    }

    private static String fld(Block b, String name) {
        return Objects.requireNonNullElse(b.fields().get(name), "");
    }

    private List<Block> slot(Block b, String name) {
        return b.slots().getOrDefault(name, List.of());
    }

    private void block(Block b, int d) {
        switch (b.kind()) {
            case "comment" -> comment(b, d);
            case "var" -> line(d, fld(b, "type") + " " + fld(b, "name")
                    + (b.fields().get("init") != null ? " = " + b.fields().get("init") : "") + ";");
            case "assign" -> line(d, fld(b, "target") + " " + fld(b, "op") + " " + fld(b, "value") + ";");
            case "expr" -> line(d, fld(b, "text") + ";");
            case "return" -> line(d, b.fields().get("value") != null ? "return " + b.fields().get("value") + ";" : "return;");
            case "throw" -> line(d, "throw " + fld(b, "value") + ";");
            case "break", "continue" -> line(d, b.kind() + (b.fields().get("label") != null ? " " + b.fields().get("label") : "") + ";");
            case "if" -> ifStmt(b, d, false);
            case "while" -> braced(d, "while (" + fld(b, "cond") + ") {", slot(b, "body"), "}");
            case "dowhile" -> braced(d, "do {", slot(b, "body"), "} while (" + fld(b, "cond") + ");");
            case "for" -> braced(d, "for (" + fld(b, "init") + ";" + spaced(fld(b, "cond")) + ";" + spaced(fld(b, "update")) + ") {",
                    slot(b, "body"), "}");
            case "foreach" -> braced(d, "for (" + fld(b, "type") + " " + fld(b, "var") + " : " + fld(b, "iterable") + ") {",
                    slot(b, "body"), "}");
            case "switch" -> {
                line(d, "switch (" + fld(b, "selector") + ") {");
                for (Block c : slot(b, "cases")) {
                    if (c.kind().equals("case")) caseBlock(c, d + 1);
                    else block(c, d + 1);
                }
                line(d, "}");
            }
            case "try" -> tryStmt(b, d);
            case "raw" -> line(d, fld(b, "text"));
            default -> {
                if (b.fields().get("text") == null) throw new IllegalArgumentException("неизвестный kind: " + b.kind());
                line(d, b.fields().get("text"));
            }
        }
    }

    private static String spaced(String s) {
        return s.isEmpty() ? "" : " " + s;
    }

    private void braced(int d, String open, List<Block> body, String close) {
        line(d, open);
        seq(body, d + 1);
        line(d, close);
    }

    /** else с единственным if — цепочка {@code else if}; chained — строка уже начата "} ". */
    private void ifStmt(Block b, int d, boolean chained) {
        out.append(chained ? "else " : ind(d)).append("if (").append(fld(b, "cond")).append(") {").append(style.eol());
        seq(slot(b, "then"), d + 1);
        List<Block> els = slot(b, "else");
        if (els.size() == 1 && els.get(0).kind().equals("if")) {
            out.append(ind(d)).append("} ");
            ifStmt(els.get(0), d, true);
        } else if (!els.isEmpty()) {
            line(d, "} else {");
            seq(els, d + 1);
            line(d, "}");
        } else {
            line(d, "}");
        }
    }

    private void caseBlock(Block c, int d) {
        String label = fld(c, "label");
        String head = label.equals("default") ? "default" : "case " + label;
        List<Block> body = slot(c, "body");
        if (!"true".equals(c.fields().get("arrow"))) {
            line(d, head + ":");
            seq(body, d + 1);
            return;
        }
        if (body.size() == 1 && (body.get(0).kind().equals("expr") || body.get(0).kind().equals("throw"))) {
            Block s = body.get(0);
            line(d, head + " -> " + (s.kind().equals("expr") ? fld(s, "text") : "throw " + fld(s, "value")) + ";");
            return;
        }
        braced(d, head + " -> {", body, "}");
    }

    /** Комментарии слота catches пишутся перед следующим catch, хвостовые — перед finally (или после try). */
    private void tryStmt(Block b, int d) {
        String res = b.fields().get("resources");
        line(d, res != null ? "try (" + res + ") {" : "try {");
        seq(slot(b, "body"), d + 1);
        List<Block> pending = new ArrayList<>();
        boolean hasCatch = false;
        for (Block c : slot(b, "catches")) {
            if (!c.kind().equals("catch")) {
                pending.add(c);
                continue;
            }
            hasCatch = true;
            String head = "catch (" + fld(c, "type") + " " + fld(c, "var") + ") {";
            closeThen(d, head, pending);
            seq(slot(c, "body"), d + 1);
        }
        List<Block> fin = slot(b, "finally");
        if (!fin.isEmpty() || (!hasCatch && res == null)) {
            closeThen(d, "finally {", pending);
            seq(fin, d + 1);
        }
        line(d, "}");
        seq(pending, d);
    }

    /** "} next" на одной строке; если перед next есть комментарии — "}", комментарии, next отдельными строками. */
    private void closeThen(int d, String next, List<Block> pending) {
        if (pending.isEmpty()) {
            line(d, "} " + next);
            return;
        }
        line(d, "}");
        seq(pending, d);
        pending.clear();
        line(d, next);
    }

    /**
     * Комментарий из исходника — ровно в исходном виде (вид и текст не меняются). Новый: однострочный — {@code // текст},
     * многострочный — {@code /* текст *\/}, многострочный с "*\/" внутри — построчно через {@code //}.
     */
    private void comment(Block b, int d) {
        String text = fld(b, "text");
        ArrayDeque<String> q = originals.get(text);
        if (q != null && !q.isEmpty()) {
            line(d, q.poll());
        } else if (NodeValidator.hasUnicodeEscape(text)) {
            // javac раскрывает \\u000a и в комментарии — хвост стал бы кодом; экранировать не будем
            throw new UnsafeCommentException(b.id(), text);
        } else if (!text.contains("\n") && !text.contains("\r")) {
            line(d, text.isEmpty() ? "//" : "// " + text);
        } else if (!text.contains("*/")) {
            line(d, "/* " + text + " */");
        } else {
            for (String l : text.split("\r\n|\r|\n", -1)) line(d, l.isBlank() ? "//" : "// " + l.strip());
        }
    }
}
