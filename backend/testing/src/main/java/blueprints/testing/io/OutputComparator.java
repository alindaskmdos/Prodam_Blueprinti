package blueprints.testing.io;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Базовое правило сравнения §10.3: stdout побайтово (CRLF ≠ LF) + exit code + тип и сообщение необработанного
 * исключения (без stack trace). Обрезанный вывод ({@code truncated}) никогда не совпадает. Строки из {@code ignoredLines} (номера с 1) не сравниваются ни в эталоне, ни в факте.
 * BE-10 передаёт сюда объединение {@code ignoreLines} и «шумных» строк — само сравнение от этого не меняется.
 */
public final class OutputComparator {

    /** @param error null, если совпало; иначе — все расхождения через «; » */
    public record Comparison(boolean matches, String error) {}

    public static final String TRUNCATED = "вывод больше 1 МБ, сравнение невозможно";

    public Comparison compare(Observed expected, Observed actual, Set<Integer> ignoredLines) {
        if (expected.truncated() || actual.truncated()) return new Comparison(false, TRUNCATED);
        List<String> diffs = new ArrayList<>();
        if (expected.exitCode() != null && !expected.exitCode().equals(actual.exitCode())) {
            diffs.add("код выхода: ожидался " + expected.exitCode() + ", получен " + actual.exitCode());
        }
        if (expected.exitCode() != null && !java.util.Objects.equals(expected.exception(), actual.exception())) {
            diffs.add("исключение: ожидалось " + describe(expected.exception()) + ", получено " + describe(actual.exception()));
        }
        String out = compareStdout(expected.stdout(), actual.stdout(), ignoredLines);
        if (out != null) diffs.add(out);
        return diffs.isEmpty() ? new Comparison(true, null) : new Comparison(false, String.join("; ", diffs));
    }

    /** null — совпадает. Иначе описание первой отличающейся строки. */
    static String compareStdout(String expected, String actual, Set<Integer> ignored) {
        List<Line> e = lines(expected, ignored);
        List<Line> a = lines(actual, ignored);
        for (int i = 0; i < Math.max(e.size(), a.size()); i++) {
            Line le = i < e.size() ? e.get(i) : null;
            Line la = i < a.size() ? a.get(i) : null;
            if (le != null && la != null && le.text.equals(la.text)) continue;
            int no = le != null ? le.no : la.no;
            return "stdout, строка " + no + ": ожидалось " + show(le) + ", получено " + show(la);
        }
        return null;
    }

    private record Line(int no, String text) {}

    /** Строки вместе с их терминатором '\n' (так «\r\n» ≠ «\n» и отсутствие перевода строки в конце видно). */
    private static List<Line> lines(String s, Set<Integer> ignored) {
        List<Line> res = new ArrayList<>();
        if (s == null || s.isEmpty()) return res;
        int start = 0;
        int no = 1;
        while (start < s.length()) {
            int nl = s.indexOf('\n', start);
            int end = nl < 0 ? s.length() : nl + 1;
            if (!ignored.contains(no)) res.add(new Line(no, s.substring(start, end)));
            start = end;
            no++;
        }
        return res;
    }

    private static String show(Line l) {
        if (l == null) return "<нет строки>";
        return "«" + l.text.replace("\r", "\\r").replace("\n", "\\n") + "»";
    }

    private static String describe(String exception) {
        return exception == null ? "без исключения" : "«" + exception + "»";
    }
}
