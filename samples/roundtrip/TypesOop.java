import java.util.List;

public class TypesOop {
    record Money(long cents, String currency) {
        Money {
            if (cents < 0) throw new IllegalArgumentException("negative");
        }

        Money(long cents) {
            this(cents, "RUB");
        }

        Money plus(Money o) {
            return new Money(cents + o.cents, currency);
        }

        static Money zero() {
            return new Money(0);
        }
    }

    enum Op {
        ADD("+") {
            int apply(int a, int b) { return a + b; }
        },
        MUL("*") {
            int apply(int a, int b) { return a * b; }
        };

        private final String symbol;

        Op(String symbol) {
            this.symbol = symbol;
        }

        String symbol() {
            return symbol;
        }

        abstract int apply(int a, int b);
    }

    interface Named {
        String name();

        default String greet() {
            return "Hello, " + name();
        }

        static Named of(String n) {
            return () -> n;
        }
    }

    static abstract class Animal implements Named {
        static int created;
        protected final String name;
        protected int legs;

        static {
            created = 0;
        }

        {
            legs = 4;
        }

        Animal(String name) {
            this.name = name;
            created++;
        }

        public String name() {
            return name;
        }

        abstract String sound();

        @Override
        public String toString() {
            return name + "(" + legs + ") says " + sound();
        }
    }

    static class Dog extends Animal {
        Dog(String name) {
            super(name);
        }

        Dog() {
            this("Rex");
        }

        String sound() {
            return "woof";
        }
    }

    static class Bird extends Animal {
        Bird(String name) {
            super(name);
            legs = 2;
        }

        String sound() {
            return "tweet";
        }

        @Override
        public String greet() {
            return super.greet() + "!";
        }
    }

    public static void main(String[] args) {
        Money m = new Money(150).plus(new Money(50, "RUB")).plus(Money.zero());
        System.out.println(m + " " + m.cents() + " " + m.equals(new Money(200)));
        for (Op op : Op.values()) System.out.println(op + " " + op.symbol() + " " + op.apply(6, 7));
        List<Animal> zoo = List.of(new Dog(), new Dog("Bim"), new Bird("Kesha"));
        for (Animal a : zoo) System.out.println(a + " / " + a.greet());
        System.out.println("created=" + Animal.created + " " + Named.of("Ann").greet());
        try {
            new Money(-1);
        } catch (IllegalArgumentException e) {
            System.out.println("rejected " + e.getMessage());
        }
    }
}
