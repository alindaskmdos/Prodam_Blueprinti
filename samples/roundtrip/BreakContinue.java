public class BreakContinue {
    public static void main(String[] args) {
        for (int i = 0; i < 10; i++) {
            if (i % 2 == 0) continue;
            if (i > 7) break;
            System.out.print(i + " ");
        }
        System.out.println();
        outer:
        for (int i = 0; i < 5; i++) {
            for (int j = 0; j < 5; j++) {
                if (j == 3) continue outer;
                if (i == 3) break outer;
                System.out.print(i + "" + j + " ");
            }
        }
        System.out.println();
        int n = 0;
        search:
        while (n < 100) {
            n++;
            int d = 2;
            do {
                if (n % d == 0 && n > 20) {
                    break search;
                }
                d++;
            } while (d < 4);
        }
        System.out.println("n=" + n);
        block:
        {
            System.out.println("in block");
            if (n > 0) break block;
            System.out.println("unreachable at runtime");
        }
        int count = 0;
        loop:
        for (String s : new String[]{"a", "skip", "b", "stop", "c"}) {
            switch (s) {
                case "skip":
                    continue loop;
                case "stop":
                    break loop;
                default:
                    count++;
            }
        }
        System.out.println("count=" + count);
    }
}
