public class IfElse {
    static String classify(int n) {
        if (n < 0) {
            return "negative";
        } else if (n == 0) {
            return "zero";
        } else if (n < 10) {
            return "small";
        } else {
            return "large";
        }
    }

    static int nested(int a, int b) {
        int r = 0;
        if (a > 0) {
            if (b > 0) {
                r = 1;
            } else {
                if (b == 0) {
                    r = 2;
                } else {
                    r = 3;
                }
            }
        }
        return r;
    }

    static int noBraces(int x) {
        int r = 0;
        if (x > 5) r = 1;
        else if (x > 2) r = 2;
        else r = 3;
        if (x % 2 == 0)
            r += 10;
        if (x == 42) ;
        ;
        if (x > 100) {
        }
        return r;
    }

    public static void main(String[] args) {
        int[] values = {-3, 0, 7, 25};
        for (int v : values) {
            System.out.println(v + " -> " + classify(v));
        }
        System.out.println(nested(1, 1) + " " + nested(1, 0) + " " + nested(1, -1) + " " + nested(-1, 5));
        for (int x = 0; x < 8; x++) {
            System.out.print(noBraces(x) + " ");
        }
        System.out.println();
        boolean flag = true;
        if (!flag || values.length > 3 && values[0] < 0) System.out.println("compound true");
    }
}
