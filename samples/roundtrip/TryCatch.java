import java.io.Closeable;

public class TryCatch {
    static class AppException extends Exception {
        final int code;

        AppException(String message, int code) {
            super(message);
            this.code = code;
        }
    }

    static class Res implements AutoCloseable {
        final String name;

        Res(String name) {
            this.name = name;
            System.out.println("open " + name);
        }

        @Override
        public void close() {
            System.out.println("close " + name);
        }
    }

    static int parse(String s) throws AppException {
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            throw new AppException("bad number: " + s, 42);
        } finally {
            System.out.println("parsed " + s);
        }
    }

    static void multi(int k) {
        try {
            if (k == 0) throw new IllegalArgumentException("zero");
            if (k == 1) throw new IllegalStateException("one");
            int[] a = new int[1];
            a[k] = 1;
        } catch (IllegalArgumentException | IllegalStateException e) {
            System.out.println("multi: " + e.getMessage());
        } catch (RuntimeException e) {
            System.out.println("runtime: " + e.getClass().getSimpleName());
        }
    }

    public static void main(String[] args) {
        try {
            System.out.println(parse("12"));
            System.out.println(parse("x"));
        } catch (AppException e) {
            System.out.println("caught " + e.getMessage() + " code=" + e.code);
        }
        for (int k = 0; k < 3; k++) multi(k);
        try (Res a = new Res("A"); Res b = new Res("B")) {
            System.out.println("using " + a.name + b.name);
        }
        Res shared = new Res("C");
        try (shared) {
            System.out.println("reuse " + shared.name);
        }
        try {
            try {
                throw new RuntimeException("inner");
            } catch (RuntimeException e) {
                System.out.println("inner caught " + e.getMessage());
                throw new IllegalStateException("rethrown", e);
            } finally {
                System.out.println("inner finally");
            }
        } catch (IllegalStateException e) {
            System.out.println("outer caught " + e.getMessage() + " cause=" + e.getCause().getMessage());
        } finally {
            System.out.println("outer finally");
        }
        try {
            System.out.println("no catch");
        } finally {
            System.out.println("only finally");
        }
        try (Closeable c = () -> System.out.println("lambda close")) {
            System.out.println("closeable body");
        } catch (Exception e) {
            System.out.println("never");
        }
    }
}
