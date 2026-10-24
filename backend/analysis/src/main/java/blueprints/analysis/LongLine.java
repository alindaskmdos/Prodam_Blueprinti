package blueprints.analysis;

import blueprints.model.Issue;
import com.github.javaparser.ast.expr.TextBlockLiteralExpr;
import java.util.ArrayList;
import java.util.List;

/**
 * §8.3: строка метода длиннее {@link #MAX_WIDTH} символов (табуляция = 4). Не считаются строки-комментарии, хвостовой
 * {@code //}-комментарий, строки внутри текстового блока и строки, где превышение даёт единственный строковый литерал.
 * Одна находка на метод, span — самая длинная строка, в message — сколько таких строк. severity low, confidence high, без fixes.
 * В recommendation — эта строка, переформатированная только переносами ({@link #reformat}), или общий пример.
 */
public final class LongLine implements Detector {
    public static final int MAX_WIDTH = 120;
    private static final String CONT = "        ";
    private static final String GENERAL = """
            result = orders.stream()
                    .filter(o -> o.isActive())
                    .map(o -> o.total())
                    .toList();""";

    @Override
    public String id() {
        return "LongLine";
    }

    @Override
    public List<Issue> detect(MethodAnalysis m, ProjectAnalysis project) {
        List<String> src = project.sourceLines(m.file());
        var d = m.declaration();
        if (src.isEmpty() || d.getBegin().isEmpty() || d.getEnd().isEmpty()) return List.of();
        int from = d.getBegin().get().line, to = Math.min(d.getEnd().get().line, src.size());
        boolean[] skip = new boolean[to + 1];
        for (TextBlockLiteralExpr tb : d.findAll(TextBlockLiteralExpr.class)) {
            int b = tb.getBegin().map(p -> p.line).orElse(0), e = tb.getEnd().map(p -> p.line).orElse(0);
            for (int i = b + 1; i <= Math.min(e, to); i++) skip[i] = true;
        }
        int count = 0, worst = -1, worstWidth = 0;
        for (int ln = from; ln <= to; ln++) {
            if (skip[ln]) continue;
            String code = code(src.get(ln - 1));
            String t = code.strip();
            if (t.isEmpty() || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) continue;
            int w = width(code);
            if (w <= MAX_WIDTH || onlyLiteral(code, w)) continue;
            count++;
            if (w > worstWidth) {
                worstWidth = w;
                worst = ln;
            }
        }
        if (worst < 0) return List.of();
        String line = src.get(worst - 1);
        String code = code(line);
        String after = reformat(code);
        String message = "Длинная строка в «" + m.name() + "»: " + worstWidth + " символов (порог " + MAX_WIDTH + ")"
                + (count > 1 ? "; строк длиннее порога в методе: " + count : "");
        String rec = "Разнести цепочку вызовов по строкам (по точкам), длинный список аргументов — по аргументу на строку, "
                + "или вынести подвыражения в переменные с говорящими именами. "
                + (after != null ? "Стало:\n" + after + line.substring(code.length()) : "Пример:\n" + GENERAL);
        int col = code.length() - code.stripLeading().length() + 1;
        return List.of(Issues.atLine(id(), "low", "high", m, worst, col, message, rec));
    }

    /**
     * Строка, переформатированная только переносами (с отступом исходной и продолжением +8), если все строки
     * укладываются в {@link #MAX_WIDTH}: цепочка вызовов по точкам, иначе самый длинный список аргументов / инициализатор
     * массива — по элементу на строку. Иначе null. Токены не меняются: убираются только пробелы в местах переноса.
     */
    public static String reformat(String line) {
        String code = code(line).stripTrailing();
        String indent = code.substring(0, code.length() - code.stripLeading().length());
        String body = code.substring(indent.length());
        boolean[] lit = literalMask(body);
        // цепочка: точки на глубине 0 после «)»
        List<Integer> dots = new ArrayList<>();
        int depth = 0;
        for (int i = 0; i < body.length(); i++) {
            if (lit[i]) continue;
            char c = body.charAt(i);
            if (c == '(' || c == '[' || c == '{') depth++;
            else if (c == ')' || c == ']' || c == '}') depth--;
            else if (c == '.' && depth == 0 && body.substring(0, i).stripTrailing().endsWith(")")) dots.add(i);
        }
        if (!dots.isEmpty()) {
            List<String> parts = new ArrayList<>();
            int prev = 0;
            for (int p : dots) {
                parts.add(body.substring(prev, p));
                prev = p;
            }
            parts.add(body.substring(prev));
            String r = join(indent, parts);
            if (fits(r)) return r;
        }
        // список аргументов / инициализатор: группы ( … ) и { … } с 2+ элементами, длинные первыми
        List<int[]> groups = new ArrayList<>();
        for (int i = 0; i < body.length(); i++) {
            if (lit[i] || (body.charAt(i) != '(' && !(body.charAt(i) == '{' && initializer(body, i)))) continue;
            int close = close(body, lit, i);
            if (close > 0 && !commas(body, lit, i, close).isEmpty()) groups.add(new int[] {i, close});
        }
        groups.sort((a, b) -> Integer.compare(b[1] - b[0], a[1] - a[0]));
        for (int[] g : groups) {
            List<String> parts = new ArrayList<>();
            parts.add(body.substring(0, g[0] + 1));
            int prev = g[0] + 1;
            for (int c : commas(body, lit, g[0], g[1])) {
                parts.add(body.substring(prev, c + 1));
                prev = c + 1;
            }
            parts.add(body.substring(prev));
            String r = join(indent, parts);
            if (fits(r)) return r;
        }
        return null;
    }

    private static String join(String indent, List<String> parts) {
        StringBuilder sb = new StringBuilder(indent).append(parts.get(0).stripTrailing());
        for (int i = 1; i < parts.size(); i++) sb.append('\n').append(indent).append(CONT).append(parts.get(i).strip());
        return sb.toString();
    }

    /** «{» инициализатора массива ({@code = {}, {@code ] {}, вложенный {@code , {}), а не тела лямбды/класса. */
    private static boolean initializer(String s, int brace) {
        String before = s.substring(0, brace).stripTrailing();
        return before.endsWith("=") || before.endsWith("]") || before.endsWith(",") || before.endsWith("{");
    }

    private static boolean fits(String text) {
        for (String l : text.split("\n")) if (width(l) > MAX_WIDTH) return false;
        return true;
    }

    /** Позиция парной закрывающей скобки или -1. */
    private static int close(String s, boolean[] lit, int open) {
        int depth = 0;
        for (int i = open; i < s.length(); i++) {
            if (lit[i]) continue;
            char c = s.charAt(i);
            if (c == '(' || c == '[' || c == '{') depth++;
            else if ((c == ')' || c == ']' || c == '}') && --depth == 0) return i;
        }
        return -1;
    }

    /** Запятые верхнего уровня внутри группы (open, close); угловые скобки дженериков учитываются грубо — по < и >. */
    private static List<Integer> commas(String s, boolean[] lit, int open, int close) {
        List<Integer> out = new ArrayList<>();
        int depth = 0, angle = 0;
        for (int i = open + 1; i < close; i++) {
            if (lit[i]) continue;
            char c = s.charAt(i);
            if (c == '(' || c == '[' || c == '{') depth++;
            else if (c == ')' || c == ']' || c == '}') depth--;
            else if (c == '<' && i + 1 < close && Character.isUpperCase(s.charAt(i + 1))) angle++;
            else if (c == '>' && angle > 0) angle--;
            else if (c == ',' && depth == 0 && angle == 0) out.add(i);
        }
        return out;
    }

    /** Код строки без хвостового {@code //}-комментария (вне литералов). */
    static String code(String line) {
        boolean[] lit = literalMask(line);
        for (int i = 0; i + 1 < line.length(); i++) {
            if (!lit[i] && line.charAt(i) == '/' && line.charAt(i + 1) == '/') return line.substring(0, i).stripTrailing();
        }
        return line.stripTrailing();
    }

    /** Ширина с табуляцией = 4. */
    static int width(String s) {
        int w = 0;
        for (int i = 0; i < s.length(); i++) w += s.charAt(i) == '\t' ? 4 : 1;
        return w;
    }

    /** Единственный строковый литерал, без которого строка укладывается в порог. */
    private static boolean onlyLiteral(String code, int w) {
        boolean[] lit = literalMask(code);
        int literals = 0, len = 0;
        for (int i = 0; i < code.length(); i++) {
            if (lit[i] && code.charAt(i) == '"' && (i == 0 || !lit[i - 1])) literals++;
            if (lit[i] && code.charAt(i) != '\'') len++;
        }
        return literals == 1 && w - len + 2 <= MAX_WIDTH;
    }

    /** true — символ внутри строкового/символьного литерала (включая кавычки). */
    static boolean[] literalMask(String s) {
        boolean[] m = new boolean[s.length()];
        char quote = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (quote != 0) {
                m[i] = true;
                if (c == '\\' && i + 1 < s.length()) m[++i] = true;
                else if (c == quote) quote = 0;
            } else if (c == '"' || c == '\'') {
                quote = c;
                m[i] = true;
            } else if (c == '/' && i + 1 < s.length() && s.charAt(i + 1) == '/') {
                break;
            }
        }
        return m;
    }
}
