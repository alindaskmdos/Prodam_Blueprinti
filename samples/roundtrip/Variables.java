public class Variables {
    static int counter = 10;

    public static void main(String[] args) {
        int a = 5;
        int b;
        b = 7;
        var c = a + b;
        final int limit = 100;
        long big = 1L << 40;
        double d = 3.75;
        int i1 = (int) d;
        long l2 = (long) i1 * 3;
        char ch = (char) ('a' + 2);
        byte by = (byte) 200;
        a += 3;
        b -= 2;
        c *= 2;
        a /= 2;
        b %= 3;
        c <<= 1;
        c >>= 2;
        c >>>= 1;
        a |= 8;
        a &= 14;
        a ^= 5;
        counter++;
        counter--;
        ++counter;
        --counter;
        int post = a++;
        int pre = ++b;
        String sign = a > 0 ? "pos" : "non-pos";
        String grade = c > 20 ? "high" : c > 10 ? "mid" : c > 5 ? "low" : "tiny";
        int max = a > b ? (a > c ? a : c) : (b > c ? b : c);
        Object o = "text";
        String s = (String) o;
        var list = new java.util.ArrayList<Integer>();
        list.add(limit);
        int x, y = 2, z;
        x = z = y * 4;
        System.out.println("a=" + a + " b=" + b + " c=" + c);
        System.out.println("big=" + big + " i1=" + i1 + " l2=" + l2);
        System.out.println("ch=" + ch + " by=" + by);
        System.out.println("counter=" + counter + " post=" + post + " pre=" + pre);
        System.out.println(sign + " " + grade + " max=" + max);
        System.out.println(s + " " + list + " x=" + x + " z=" + z);
    }
}
