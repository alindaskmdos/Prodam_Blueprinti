package blueprints.analysis;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Асимптотика: сумма несравнимых слагаемых, слагаемое — произведение символов размера в степенях и log-множителей.
 * {@link #plus} = максимум (доминируемые слагаемые выбрасываются), {@link #times} = произведение.
 * Значения нормализованы, поэтому {@code equals} сравнивает асимптотики. Ключи символов — внутренние
 * (имя параметра/поля/выражения); {@link #toString()} переименовывает их в n, m, k… — форма для бейджа.
 */
public record BigO(List<Term> terms) {
    public static final BigO ONE = new BigO(List.of(Term.ONE));

    /** pow: символ → степень, log: символ → степень log-множителя. Пустой терм = O(1). */
    public record Term(Map<String, Integer> pow, Map<String, Integer> log) {
        static final Term ONE = new Term(Map.of(), Map.of());

        public Term {
            pow = Collections.unmodifiableMap(new TreeMap<>(pow));
            log = Collections.unmodifiableMap(new TreeMap<>(log));
        }

        Term times(Term o) {
            Map<String, Integer> p = new TreeMap<>(pow), l = new TreeMap<>(log);
            o.pow.forEach((k, v) -> p.merge(k, v, Integer::sum));
            o.log.forEach((k, v) -> l.merge(k, v, Integer::sum));
            return new Term(p, l);
        }

        /** Для каждого символа (степень, степень log) не меньше лексикографически: n ≥ n·log? нет; n² ≥ n log n — да. */
        boolean dominates(Term o) {
            Set<String> all = new TreeSet<>(pow.keySet());
            all.addAll(log.keySet());
            all.addAll(o.pow.keySet());
            all.addAll(o.log.keySet());
            for (String s : all) {
                int c = Integer.compare(pow.getOrDefault(s, 0), o.pow.getOrDefault(s, 0));
                if (c == 0) c = Integer.compare(log.getOrDefault(s, 0), o.log.getOrDefault(s, 0));
                if (c < 0) return false;
            }
            return true;
        }

        /** Символы терма: старшая степень первой, затем старшая степень log, затем ключ — детерминированно. */
        List<String> ordered() {
            Set<String> all = new TreeSet<>(pow.keySet());
            all.addAll(log.keySet());
            List<String> out = new ArrayList<>(all);
            out.sort(Comparator.<String>comparingInt(k -> -pow.getOrDefault(k, 0))
                    .thenComparingInt(k -> -log.getOrDefault(k, 0)));
            return out;
        }

        int degree() {
            return pow.values().stream().mapToInt(Integer::intValue).sum();
        }

        int logDegree() {
            return log.values().stream().mapToInt(Integer::intValue).sum();
        }
    }

    public BigO {
        terms = normalize(terms);
    }

    /** O(symbol). */
    public static BigO of(String symbol) {
        return new BigO(List.of(new Term(Map.of(symbol, 1), Map.of())));
    }

    /** O(log symbol). */
    public static BigO log(String symbol) {
        return new BigO(List.of(new Term(Map.of(), Map.of(symbol, 1))));
    }

    /** Последовательность: максимум. */
    public BigO plus(BigO o) {
        List<Term> all = new ArrayList<>(terms);
        all.addAll(o.terms);
        return new BigO(all);
    }

    /** Вложенность: произведение. */
    public BigO times(BigO o) {
        List<Term> all = new ArrayList<>();
        for (Term a : terms) for (Term b : o.terms) all.add(a.times(b));
        return new BigO(all);
    }

    /** log f ≈ сумма log по символам f (log(n²·m) = O(log n + log m)); log константы — O(1). */
    public BigO log() {
        BigO r = null;
        for (String s : symbols()) r = r == null ? log(s) : r.plus(log(s));
        return r == null ? ONE : r;
    }

    /** Подстановка символов (параметр вызываемого метода → размер аргумента); остальные символы не меняются. */
    public BigO substitute(Map<String, BigO> values) {
        BigO r = null;
        for (Term t : terms) {
            BigO x = ONE;
            for (var e : t.pow.entrySet()) {
                BigO base = values.getOrDefault(e.getKey(), of(e.getKey()));
                for (int i = 0; i < e.getValue(); i++) x = x.times(base);
            }
            for (var e : t.log.entrySet()) {
                BigO base = values.getOrDefault(e.getKey(), of(e.getKey())).log();
                for (int i = 0; i < e.getValue(); i++) x = x.times(base);
            }
            r = r == null ? x : r.plus(x);
        }
        return r;
    }

    public boolean isConstant() {
        return terms.equals(List.of(Term.ONE));
    }

    /** Хотя бы O(n): есть слагаемое со степенью символа ≥ 1 (порог ExpensiveCallInLoop). */
    public boolean isAtLeastLinear() {
        return terms.stream().anyMatch(t -> t.degree() > 0);
    }

    /** Символы (внутренние ключи) в порядке вывода. */
    public Set<String> symbols() {
        Set<String> s = new LinkedHashSet<>();
        for (Term t : terms) s.addAll(t.ordered());
        return s;
    }

    /** Порядок числа операций при всех символах = n: максимум по слагаемым n^степень · log₂(n)^степень. */
    public double ops(long n) {
        double lg = Math.max(1, Math.log(n) / Math.log(2));
        return terms.stream().mapToDouble(t -> Math.pow(n, t.degree()) * Math.pow(lg, t.logDegree())).max().orElse(1);
    }

    /** Без переименования: короткие имена символов (часть ключа после «|»), например {@code O(orders·items)} — для отладки и тестов. */
    public String raw() {
        return format(Map.of());
    }

    private static String shortName(String key) {
        return key.substring(key.indexOf('|') + 1);
    }

    /**
     * Упрощённая форма для бейджа: символы переименованы в n, m, k… — первым символ старшей степени
     * в старшем слагаемом ({@code O(n²·m·k)}, {@code O(n log n)}),
     * не больше {@value #BADGE_TERMS} старших слагаемых, остальные — «…».
     */
    @Override
    public String toString() {
        BigO shown = terms.size() > BADGE_TERMS ? new BigO(terms.subList(0, BADGE_TERMS)) : this;
        Map<String, String> names = new LinkedHashMap<>();
        for (String s : shown.symbols()) names.put(s, NAMES[names.size() % NAMES.length] + (names.size() < NAMES.length ? "" : names.size() / NAMES.length));
        String f = shown.format(names);
        return shown == this ? f : f.substring(0, f.length() - 1) + " + …)";
    }

    private static final int BADGE_TERMS = 3;

    private static final String[] NAMES = {"n", "m", "k", "p", "q", "r", "s", "t"};

    private String format(Map<String, String> names) {
        List<String> parts = new ArrayList<>();
        for (Term t : terms) {
            List<String> p = new ArrayList<>();
            List<String> l = new ArrayList<>();
            for (String k : t.ordered()) {
                String n = names.getOrDefault(k, shortName(k));
                if (t.pow.containsKey(k)) p.add(n + power(t.pow.get(k)));
                if (t.log.containsKey(k)) l.add("log" + power(t.log.get(k)) + " " + n);
            }
            String s = String.join("·", p);
            if (!l.isEmpty()) s = (s.isEmpty() ? "" : s + " ") + String.join("·", l);
            parts.add(s.isEmpty() ? "1" : s);
        }
        return "O(" + String.join(" + ", parts) + ")";
    }

    private static String power(int v) {
        return switch (v) {
            case 1 -> "";
            case 2 -> "²";
            case 3 -> "³";
            default -> "^" + v;
        };
    }

    /** Убирает доминируемые и повторные слагаемые, сортирует: старшие первыми. */
    private static List<Term> normalize(List<Term> in) {
        List<Term> out = new ArrayList<>();
        for (int i = 0; i < in.size(); i++) {
            Term t = in.get(i);
            boolean drop = false;
            for (int j = 0; j < in.size() && !drop; j++) {
                if (i == j) continue;
                Term o = in.get(j);
                // равные: оставляем первый
                drop = o.dominates(t) && (!t.dominates(o) || j < i);
            }
            if (!drop) out.add(t);
        }
        if (out.isEmpty()) out.add(Term.ONE);
        out.sort(Comparator.comparingInt(Term::degree).reversed()
                .thenComparing(Comparator.comparingInt(Term::logDegree).reversed())
                .thenComparing(t -> t.pow + "" + t.log));
        return List.copyOf(out);
    }
}
