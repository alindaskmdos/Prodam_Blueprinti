import java.util.Comparator;

public class NestedClasses {
    private int value = 5;

    static class StaticNested {
        String hello() {
            return "static nested";
        }
    }

    class Inner {
        int doubled() {
            return value * 2;
        }
    }

    interface Greeter {
        String greet(String name);
    }

    public static void main(String[] args) {
        System.out.println(new StaticNested().hello());
        NestedClasses outer = new NestedClasses();
        NestedClasses.Inner inner = outer.new Inner();
        System.out.println("inner " + inner.doubled());
        Greeter anon = new Greeter() {
            private int calls = 0;

            @Override
            public String greet(String name) {
                calls++;
                return "hi " + name + " #" + calls;
            }
        };
        System.out.println(anon.greet("ann"));
        System.out.println(anon.greet("bob"));
        Comparator<String> byLen = new Comparator<>() {
            public int compare(String a, String b) {
                return Integer.compare(a.length(), b.length());
            }
        };
        System.out.println(byLen.compare("aa", "b"));
        class Counter {
            int n;

            void tick() {
                n++;
            }
        }
        Counter c = new Counter();
        c.tick();
        c.tick();
        System.out.println("local class " + c.n);
        record Point(int x, int y) {
            int sum() {
                return x + y;
            }
        }
        Point p = new Point(3, 4);
        System.out.println(p + " sum=" + p.sum());
        enum Level { LOW, HIGH }
        for (Level l : Level.values()) System.out.print(l.ordinal() + l.name() + " ");
        System.out.println();
        interface Shape {
            double area();
        }
        Shape sq = () -> 4.0;
        System.out.println("area " + sq.area());
    }
}
