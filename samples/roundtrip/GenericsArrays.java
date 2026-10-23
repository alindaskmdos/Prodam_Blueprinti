import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class GenericsArrays {
    static class Box<T extends Comparable<T>> {
        private T item;

        Box(T item) {
            this.item = item;
        }

        T get() {
            return item;
        }

        boolean biggerThan(Box<? extends T> other) {
            return item.compareTo(other.get()) > 0;
        }
    }

    static <T> T firstOr(List<T> xs, T fallback) {
        return xs.isEmpty() ? fallback : xs.get(0);
    }

    static double sumAll(List<? extends Number> nums) {
        double s = 0;
        for (Number n : nums) s += n.doubleValue();
        return s;
    }

    static void fill(List<? super Integer> sink, int n) {
        for (int i = 0; i < n; i++) sink.add(i);
    }

    static int sum(int... xs) {
        int s = 0;
        for (int x : xs) s += x;
        return s;
    }

    static String join(String sep, String... parts) {
        return String.join(sep, parts);
    }

    public static void main(String[] args) {
        Box<Integer> a = new Box<>(7);
        Box<Integer> b = new Box<>(3);
        System.out.println(a.biggerThan(b) + " " + b.biggerThan(a));
        System.out.println(firstOr(List.of("x", "y"), "none") + " " + firstOr(new ArrayList<String>(), "none"));
        System.out.println(GenericsArrays.<Integer>firstOr(List.of(), -1));
        System.out.println(sumAll(List.of(1, 2.5, 3L)));
        List<Number> sink = new ArrayList<>();
        fill(sink, 3);
        System.out.println(sink);
        System.out.println(sum() + " " + sum(1) + " " + sum(1, 2, 3) + " " + sum(new int[]{4, 5}));
        System.out.println(join("-", "a", "b", "c"));
        int[] nums = new int[4];
        nums[0] = 9;
        nums[nums.length - 1] = nums[0] + 1;
        String[] names = {"x", "y"};
        int[][] matrix = new int[3][3];
        for (int i = 0; i < 3; i++)
            for (int j = 0; j < 3; j++)
                matrix[i][j] = i * j;
        int[][] jagged = {{1}, {2, 3}, {}};
        char[][][] cube = new char[2][2][];
        cube[1][1] = new char[]{'o', 'k'};
        System.out.println(Arrays.toString(nums) + " " + Arrays.toString(names));
        System.out.println(Arrays.deepToString(matrix) + " " + Arrays.deepToString(jagged));
        System.out.println(new String(cube[1][1]) + " " + jagged[1].length);
        List<int[]> pairs = new ArrayList<>();
        pairs.add(new int[]{1, 2});
        System.out.println(pairs.get(0)[1]);
    }
}
