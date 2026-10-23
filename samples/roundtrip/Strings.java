public class Strings {
    public static void main(String[] args) {
        String block = """
                Hello,
                  "text block"
                end\
                """;
        System.out.println(block);
        String esc = "tab\there\nnew line \"quoted\" back\\slash 'single' Aé";
        System.out.println(esc);
        char c1 = '\n';
        char c2 = '\'';
        char c3 = 'B';
        System.out.println((int) c1 + " " + c2 + " " + c3);
        String unicode = "Привет, мир — ünïcödé ✓";
        System.out.println(unicode + " len=" + unicode.length());
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 5; i++) {
            sb.append(i).append(',');
        }
        sb.setLength(sb.length() - 1);
        sb.insert(0, "[").append("]");
        System.out.println(sb + " rev=" + new StringBuilder("abc").reverse());
        int n = 3;
        double d = 1.5;
        System.out.println("n+d=" + n + d);
        System.out.println("n+d=" + (n + d));
        System.out.println(n + d + "=sum");
        System.out.println(1 + 2 + "3" + 4 + 5);
        String s = null;
        System.out.println("null concat: " + s);
        String fmt = String.format(java.util.Locale.ROOT, "%5d|%-4s|%.2f", 42, "ab", 3.14159);
        System.out.println(fmt);
        System.out.println("a,b,,c".split(",").length + " " + "  trim  ".strip() + "|" + "x".repeat(3));
        String multi = "line1\r\nline2";
        System.out.println(multi.lines().count());
        System.out.println("abc".compareTo("abd") + " " + "Abc".equalsIgnoreCase("aBC"));
    }
}
