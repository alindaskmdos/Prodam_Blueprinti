import java.util.Scanner;

public class ScannerInput {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        long sum = 0;
        int max = Integer.MIN_VALUE;
        for (int i = 0; i < n; i++) {
            int v = in.nextInt();
            sum += v;
            if (v > max) max = v;
        }
        in.nextLine();
        System.out.println("sum=" + sum + " max=" + max);
        int lines = 0;
        while (in.hasNextLine()) {
            String line = in.nextLine().trim();
            if (line.isEmpty()) continue;
            if (line.equals("end")) break;
            lines++;
            String[] parts = line.split("\\s+");
            switch (parts[0]) {
                case "hello" -> System.out.println("Hello, " + (parts.length > 1 ? parts[1] : "anon") + "!");
                case "rev" -> System.out.println(new StringBuilder(line.substring(4)).reverse());
                default -> System.out.println("unknown: " + parts[0]);
            }
        }
        System.out.println("lines=" + lines);
    }
}
