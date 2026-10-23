import java.util.ArrayList;
import java.util.List;

public class Recursion {
    static long factorial(int n) {
        if (n <= 1) return 1;
        return n * factorial(n - 1);
    }

    static int fib(int n) {
        return n < 2 ? n : fib(n - 1) + fib(n - 2);
    }

    static int gcd(int a, int b) {
        if (b == 0) {
            return a;
        }
        return gcd(b, a % b);
    }

    static boolean isEven(int n) {
        return n == 0 || isOdd(n - 1);
    }

    static boolean isOdd(int n) {
        return n != 0 && isEven(n - 1);
    }

    static void permutations(String prefix, String rest, List<String> out) {
        if (rest.isEmpty()) {
            out.add(prefix);
            return;
        }
        for (int i = 0; i < rest.length(); i++) {
            permutations(prefix + rest.charAt(i), rest.substring(0, i) + rest.substring(i + 1), out);
        }
    }

    static void hanoi(int n, char from, char to, char via, StringBuilder log) {
        if (n == 0) return;
        hanoi(n - 1, from, via, to, log);
        log.append(from).append(to).append(' ');
        hanoi(n - 1, via, to, from, log);
    }

    public static void main(String[] args) {
        System.out.println("10! = " + factorial(10));
        System.out.println("fib(15) = " + fib(15));
        System.out.println("gcd = " + gcd(84, 36));
        System.out.println("even(7)=" + isEven(7) + " odd(7)=" + isOdd(7));
        List<String> perms = new ArrayList<>();
        permutations("", "abc", perms);
        System.out.println(perms);
        StringBuilder log = new StringBuilder();
        hanoi(3, 'A', 'C', 'B', log);
        System.out.println(log.toString().trim());
    }
}
