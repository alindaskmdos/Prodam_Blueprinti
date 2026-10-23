package blueprints.testing;

import java.util.Map;
import java.util.regex.Pattern;

/**
 * Эвристика §10.5: читает ли программа стандартный ввод. Ищется {@code System.in} (покрывает
 * {@code new Scanner(System.in)}, {@code new BufferedReader(new InputStreamReader(System.in))},
 * {@code System.in.read()}, {@code import static java.lang.System.in}) и {@code System.console()} — в коде без
 * комментариев, строковых, символьных литералов и text block'ов. Пробелы вокруг точки допускаются.
 * Не видит чтение через рефлексию, {@code FileDescriptor.in}, {@code import static java.lang.System.*} с голым
 * {@code in} и стороннюю обёртку — тогда блокировки нет (ложный зелёный возможен только без IO-тестов со входом).
 */
public final class StdinUsage {

    private static final Pattern READS = Pattern.compile("\\bSystem\\s*\\.\\s*(in\\b|console\\s*\\()");

    private StdinUsage() {}

    /** Хоть один из исходников (путь → текст) читает stdin. */
    public static boolean readsStdin(Map<String, String> sources) {
        return sources.values().stream().anyMatch(code -> READS.matcher(stripLiteralsAndComments(code)).find());
    }

    /** Заменяет комментарии и литералы пробелами (переводы строк сохраняются). */
    static String stripLiteralsAndComments(String code) {
        StringBuilder sb = new StringBuilder(code.length());
        int i = 0;
        int n = code.length();
        while (i < n) {
            char c = code.charAt(i);
            if (c == '/' && i + 1 < n && code.charAt(i + 1) == '/') {
                while (i < n && code.charAt(i) != '\n') i++;
            } else if (c == '/' && i + 1 < n && code.charAt(i + 1) == '*') {
                int end = code.indexOf("*/", i + 2);
                i = blank(code, i, end < 0 ? n : end + 2, sb);
            } else if (code.startsWith("\"\"\"", i)) {
                int j = i + 3;
                while (j < n && !code.startsWith("\"\"\"", j)) j += code.charAt(j) == '\\' ? 2 : 1;
                i = blank(code, i, Math.min(n, j + 3), sb);
            } else if (c == '"' || c == '\'') {
                int j = i + 1;
                while (j < n && code.charAt(j) != c && code.charAt(j) != '\n') j += code.charAt(j) == '\\' ? 2 : 1;
                i = blank(code, i, Math.min(n, j + 1), sb);
            } else {
                sb.append(c);
                i++;
            }
        }
        return sb.toString();
    }

    private static int blank(String code, int from, int to, StringBuilder sb) {
        for (int k = from; k < to; k++) sb.append(code.charAt(k) == '\n' ? '\n' : ' ');
        return to;
    }
}
