package blueprints.cli;

import blueprints.analysis.BigO;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import picocli.CommandLine.ITypeConverter;
import picocli.CommandLine.TypeConversionException;

/**
 * Порядок роста для --fail-on: суммарная степень символов и степень log старшего слагаемого, все символы = n
 * (как {@link BigO#ops}): O(n·m) ~ O(n²), O(n log n) между O(n) и O(n²).
 */
record Rank(int degree, int log) implements Comparable<Rank> {
    /** Множитель: log[^k] x | x[^k] | 1; разделители · и * (пробелы убираются заранее). */
    private static final Pattern TOKEN = Pattern.compile("log(?:\\^(\\d+))?([a-z])|([a-z])(?:\\^(\\d+))?|1|·|\\*");

    static Rank of(BigO o) {
        Rank max = new Rank(0, 0);
        for (BigO.Term t : o.terms()) {
            Rank r = new Rank(t.pow().values().stream().mapToInt(Integer::intValue).sum(),
                    t.log().values().stream().mapToInt(Integer::intValue).sum());
            if (r.compareTo(max) > 0) max = r;
        }
        return max;
    }

    /** Формат бейджа analysis ({@code O(n²)}, {@code O(n log n)}) или ASCII ({@code O(n^2)}); одно слагаемое. */
    static Rank parse(String s) {
        String t = s.toLowerCase().replace("²", "^2").replace("³", "^3").replaceAll("\\s+", "");
        if (!t.startsWith("o(") || !t.endsWith(")") || t.length() == 3) throw bad(s);
        String body = t.substring(2, t.length() - 1);
        Matcher m = TOKEN.matcher(body);
        int degree = 0, log = 0;
        for (int pos = 0; pos < body.length(); pos = m.end()) {
            m.region(pos, body.length());
            if (!m.lookingAt()) throw bad(s);
            if (m.group(2) != null) log += m.group(1) == null ? 1 : Integer.parseInt(m.group(1));
            else if (m.group(3) != null) degree += m.group(4) == null ? 1 : Integer.parseInt(m.group(4));
        }
        return new Rank(degree, log);
    }

    private static IllegalArgumentException bad(String s) {
        return new IllegalArgumentException("не понимаю сложность «" + s + "»: нужно одно слагаемое, например O(n^2), O(n²), O(n log n)");
    }

    @Override
    public int compareTo(Rank o) {
        return degree != o.degree ? Integer.compare(degree, o.degree) : Integer.compare(log, o.log);
    }

    /** Для picocli: неверная строка → ошибка аргументов (код 2). */
    static final class Converter implements ITypeConverter<Rank> {
        @Override
        public Rank convert(String value) {
            try {
                return parse(value);
            } catch (IllegalArgumentException e) {
                throw new TypeConversionException(e.getMessage());
            }
        }
    }
}
