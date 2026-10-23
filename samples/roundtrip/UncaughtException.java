public class UncaughtException {
    static class ValidationException extends RuntimeException {
        ValidationException(String message) {
            super(message);
        }
    }

    static int validate(int age) {
        if (age < 0) {
            throw new ValidationException("age must be >= 0, got " + age);
        }
        return age;
    }

    public static void main(String[] args) {
        int[] ages = {30, 15, -4, 20};
        int sum = 0;
        for (int age : ages) {
            sum += validate(age);
            System.out.println("ok " + age + " sum=" + sum);
        }
        System.out.println("never printed");
    }
}
