import java.util.List;

public class RareConstructs {
    sealed interface Shape permits Circle, Rect {}

    record Circle(double r) implements Shape {}

    record Rect(double w, double h) implements Shape {}

    record Pair<A, B>(A first, B second) {}

    private final Object lock = new Object();
    private int counter;

    void increment() {
        synchronized (lock) {
            counter++;
        }
        synchronized (this) {
            counter += 10;
        }
    }

    <T> List<T> listOf(T a, T b) {
        return List.of(a, b);
    }

    List<String> explicitCall() {
        return this.<String>listOf("p", "q");
    }

    static String describe(Object o) {
        if (o instanceof String s && s.length() > 2) {
            return "long string " + s;
        }
        if (!(o instanceof Integer i)) {
            return "other " + o;
        }
        return "int " + (i + 1);
    }

    static String area(Shape shape) {
        return switch (shape) {
            case Circle c when c.r() == 0 -> "dot";
            case Circle c -> "circle " + Math.round(Math.PI * c.r() * c.r());
            case Rect(double w, double h) -> "rect " + (w * h);
        };
    }

    static String pairInfo(Object o) {
        if (o instanceof Pair(String a, Integer b)) {
            return a + ":" + b;
        }
        return switch (o) {
            case null -> "null!";
            case Integer n when n > 10 -> "big " + n;
            case Integer n -> "small " + n;
            default -> "unknown";
        };
    }

    public static void main(String[] args) {
        RareConstructs rc = new RareConstructs();
        rc.increment();
        rc.increment();
        System.out.println("counter=" + rc.counter);
        int x = 5;
        assert x > 0 : "x must be positive";
        assert x < 100;
        System.out.println(rc.explicitCall());
        System.out.println(describe("hello") + "; " + describe("hi") + "; " + describe(41));
        System.out.println(area(new Circle(0)) + "; " + area(new Circle(2)) + "; " + area(new Rect(2, 3.5)));
        System.out.println(pairInfo(new Pair<>("k", 9)) + "; " + pairInfo(null) + "; " + pairInfo(50) + "; " + pairInfo(3) + "; " + pairInfo("s"));
    }
}
