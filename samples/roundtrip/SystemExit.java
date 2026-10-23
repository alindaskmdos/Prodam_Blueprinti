public class SystemExit {
    static void process(int[] values) {
        int total = 0;
        for (int v : values) {
            if (v < 0) {
                System.out.println("negative value " + v + ", exiting");
                System.exit(3);
            }
            total += v;
            System.out.println("total=" + total);
        }
        System.out.println("never printed");
    }

    public static void main(String[] args) {
        System.out.println("start");
        try {
            process(new int[]{4, 6, -1, 8});
        } finally {
            System.out.println("finally is skipped by System.exit");
        }
    }
}
