public class WhileLoops {
    static int digitSum(int n) {
        int sum = 0;
        while (n > 0) {
            sum += n % 10;
            n /= 10;
        }
        return sum;
    }

    static int countDown(int from) {
        int steps = 0;
        do {
            from -= 3;
            steps++;
        } while (from > 0);
        return steps;
    }

    public static void main(String[] args) {
        System.out.println("digitSum=" + digitSum(98765));
        System.out.println("countDown=" + countDown(10) + " " + countDown(-5));
        int i = 0;
        while (i < 3) i++;
        System.out.println("i=" + i);
        int j = 0;
        do j += 2; while (j < 7);
        System.out.println("j=" + j);
        int k = 0;
        while (true) {
            k++;
            if (k * k > 50) {
                break;
            }
        }
        System.out.println("k=" + k);
        int outer = 0;
        while (outer < 3) {
            int inner = 0;
            do {
                System.out.print(outer + ":" + inner + " ");
                inner++;
            } while (inner < 2);
            outer++;
        }
        System.out.println();
        int n = 5;
        while (n-- > 0) {
        }
        System.out.println("n=" + n);
    }
}
