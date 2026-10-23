import java.util.List;

public class ForLoops {
    public static void main(String[] args) {
        int total = 0;
        for (int i = 0; i < 5; i++) {
            total += i;
        }
        System.out.println("total=" + total);
        for (int i = 0, j = 10; i < j; i++, j -= 2) {
            System.out.print("(" + i + "," + j + ")");
        }
        System.out.println();
        int k = 0;
        for (; k < 3; ) {
            k++;
        }
        System.out.println("k=" + k);
        int m = 0;
        for (;;) {
            if (++m >= 4) break;
        }
        System.out.println("m=" + m);
        for (int i = 10; i > 0; i /= 2) System.out.print(i + " ");
        System.out.println();
        List<String> names = List.of("ann", "bob", "cid");
        for (String name : names) {
            System.out.print(name.toUpperCase(java.util.Locale.ROOT) + " ");
        }
        System.out.println();
        int[] arr = {3, 1, 4, 1, 5};
        int sum = 0;
        for (int v : arr) sum += v;
        System.out.println("sum=" + sum);
        for (final var name : names) {
            System.out.print(name.length());
        }
        System.out.println();
        int[][] grid = {{1, 2}, {3, 4}, {5, 6}};
        for (int[] row : grid) {
            for (int cell : row) {
                System.out.print(cell * 10 + " ");
            }
        }
        System.out.println();
        for (char c = 'a'; c <= 'e'; c += 2) {
            System.out.print(c);
        }
        System.out.println();
    }
}
