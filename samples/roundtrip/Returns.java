import java.util.List;

public class Returns {
    static int firstNegative(List<Integer> xs) {
        for (int x : xs) {
            if (x < 0) {
                return x;
            }
        }
        return 0;
    }

    static void printPositive(int n) {
        if (n <= 0) {
            System.out.println("skip " + n);
            return;
        }
        System.out.println("positive " + n);
    }

    static String early(String s) {
        if (s == null) return "null";
        if (s.isEmpty()) return "empty";
        int i = 0;
        while (i < s.length()) {
            if (Character.isDigit(s.charAt(i))) return "digit at " + i;
            i++;
        }
        return "no digit";
    }

    static boolean isEven(int n) {
        return n % 2 == 0;
    }

    static void nothing() {
        return;
    }

    static int ternaryReturn(int a) {
        return a > 3 ? a * 2 : -a;
    }

    public static void main(String[] args) {
        System.out.println(firstNegative(List.of(3, 5, -2, -7)));
        System.out.println(firstNegative(List.of(1, 2)));
        printPositive(5);
        printPositive(-1);
        System.out.println(early(null) + "; " + early("") + "; " + early("ab3c") + "; " + early("xyz"));
        System.out.println(isEven(4) + " " + isEven(7));
        nothing();
        System.out.println(ternaryReturn(5) + " " + ternaryReturn(2));
    }
}
