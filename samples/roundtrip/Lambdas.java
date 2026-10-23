import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.function.BiFunction;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

public class Lambdas {
    static int twice(int x) {
        return x * 2;
    }

    public static void main(String[] args) {
        Function<Integer, Integer> inc = x -> x + 1;
        BiFunction<Integer, Integer, Integer> add = (a, b) -> a + b;
        Supplier<String> hello = () -> "hello";
        Predicate<String> longWord = s -> {
            int len = s.length();
            return len > 3;
        };
        Function<Integer, Integer> tw = Lambdas::twice;
        Function<String, Integer> len = String::length;
        Supplier<List<String>> mk = ArrayList::new;
        System.out.println(inc.apply(4) + " " + add.apply(2, 3) + " " + hello.get());
        System.out.println(longWord.test("abc") + " " + longWord.test("abcd"));
        System.out.println(tw.andThen(inc).apply(10) + " " + len.apply("four"));
        List<String> words = mk.get();
        words.add("pear");
        words.add("fig");
        words.add("banana");
        words.add("kiwi");
        List<String> sorted = words.stream()
                .filter(w -> w.length() > 3)
                .map(w -> w.toUpperCase(Locale.ROOT))
                .sorted(Comparator.comparing(String::length).thenComparing(Comparator.reverseOrder()))
                .collect(Collectors.toList());
        System.out.println(sorted);
        int sumSq = IntStream.rangeClosed(1, 5).map(i -> i * i).sum();
        System.out.println("sumSq=" + sumSq);
        String joined = words.stream().collect(Collectors.joining(",", "[", "]"));
        System.out.println(joined);
        words.forEach(w -> System.out.print(w.charAt(0)));
        System.out.println();
        Runnable r = () -> System.out.println("run");
        r.run();
        words.removeIf(w -> w.startsWith("f"));
        words.replaceAll(w -> w + "!");
        System.out.println(words);
        int base = 100;
        Function<Integer, Function<Integer, Integer>> curried = a -> b -> a * b + base;
        System.out.println(curried.apply(3).apply(4));
    }
}
