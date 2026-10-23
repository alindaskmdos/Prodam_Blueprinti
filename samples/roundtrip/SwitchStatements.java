public class SwitchStatements {
    enum Color { RED, GREEN, BLUE, BLACK }

    static String oldInt(int n) {
        String r = "";
        switch (n) {
            case 1:
                r += "one ";
            case 2:
                r += "two ";
                break;
            case 3:
            case 4:
                r += "three-or-four ";
                break;
            default:
                r += "other ";
        }
        return r.trim();
    }

    static int oldString(String s) {
        switch (s) {
            case "a": return 1;
            case "b": {
                int x = 2;
                return x * 10;
            }
            default: return -1;
        }
    }

    static String oldEnum(Color c) {
        switch (c) {
            case RED:
                return "warm";
            case GREEN:
            case BLUE:
                return "cool";
            default:
                break;
        }
        return "none";
    }

    static void arrowStatement(Color c) {
        switch (c) {
            case RED -> System.out.println("arrow red");
            case GREEN, BLUE -> {
                String n = c.name().toLowerCase(java.util.Locale.ROOT);
                System.out.println("arrow " + n);
            }
            default -> System.out.println("arrow default");
        }
    }

    static int switchExpr(String day) {
        int len = switch (day) {
            case "MON", "TUE" -> 1;
            case "WED" -> {
                int t = day.length();
                yield t * 2;
            }
            default -> 0;
        };
        return len;
    }

    static String oldStyleExpr(int k) {
        return switch (k) {
            case 0:
                yield "zero";
            case 1:
                String s = "one";
                yield s.toUpperCase(java.util.Locale.ROOT);
            default:
                yield "many";
        };
    }

    public static void main(String[] args) {
        for (int i = 1; i <= 5; i++) System.out.println(i + ": " + oldInt(i));
        System.out.println(oldString("a") + " " + oldString("b") + " " + oldString("z"));
        for (Color c : Color.values()) {
            System.out.println(c + " " + oldEnum(c));
            arrowStatement(c);
        }
        System.out.println(switchExpr("MON") + " " + switchExpr("WED") + " " + switchExpr("SUN"));
        System.out.println(oldStyleExpr(0) + " " + oldStyleExpr(1) + " " + oldStyleExpr(9));
    }
}
