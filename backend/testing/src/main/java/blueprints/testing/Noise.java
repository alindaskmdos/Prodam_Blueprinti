package blueprints.testing;

import java.util.ArrayList;
import java.util.List;

/**
 * Недетерминизм (§10.4): «шумные» строки — различающиеся между двумя прогонами оригинала на одном входе.
 * Строка сравнивается вместе с переводом строки (как в {@code OutputComparator}). Если прогоны дали разное число
 * строк, «лишние» строки более длинного прогона (нет пары) тоже шумные: номера от min+1 до max.
 */
public final class Noise {

    private Noise() {}

    /** Номера (с 1) строк, различающихся между двумя выводами, по возрастанию. */
    public static List<Integer> noisyLines(String run1, String run2) {
        List<String> a = lines(run1);
        List<String> b = lines(run2);
        List<Integer> res = new ArrayList<>();
        for (int i = 0; i < Math.max(a.size(), b.size()); i++) {
            if (i >= a.size() || i >= b.size() || !a.get(i).equals(b.get(i))) res.add(i + 1);
        }
        return res;
    }

    /**
     * Шумных строк больше половины вывода: {@code 2 * |noisyLines| > N}, где N — число строк эталона
     * ({@code expected}, у original-теста это вывод первого прогона оригинала), но не меньше номера последней
     * шумной строки (у второго прогона строк могло быть больше).
     */
    public static boolean mostlyNoise(TestResult r) {
        if (r.noisyLines().isEmpty()) return false;
        int total = Math.max(lines(r.expected()).size(), r.noisyLines().stream().mapToInt(Integer::intValue).max().orElse(0));
        return 2L * r.noisyLines().size() > total;
    }

    /** Строки вместе с терминатором '\n'; пустой/null вывод — ноль строк. */
    static List<String> lines(String s) {
        List<String> res = new ArrayList<>();
        if (s == null) return res;
        int start = 0;
        while (start < s.length()) {
            int nl = s.indexOf('\n', start);
            int end = nl < 0 ? s.length() : nl + 1;
            res.add(s.substring(start, end));
            start = end;
        }
        return res;
    }
}
