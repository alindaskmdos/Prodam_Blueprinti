/**
 * Javadoc класса: демонстрирует все виды комментариев.
 */
public class Comments {
    // поле с комментарием
    static int total = 0; // в конце строки поля

    /**
     * Javadoc метода.
     *
     * @param n число
     * @return квадрат
     */
    static int square(int n) {
        // строчный комментарий в начале тела
        int r = n * n; // в конце строки
        /* блочный комментарий */
        /*
         * многострочный
         * блочный комментарий
         */
        return r;
    }

    static int sum(int a, int b) {
        return a + /* внутри выражения */ b;
    }

    public static void main(String[] args) {
        // начало main
        for (int i = 1; i <= 3; i++) {
            // внутри цикла
            total += square(i); // накопление
        }
        if (total > 10) {
            // ветка then
            System.out.println("big " + total);
        } else {
            /* ветка else */
            System.out.println("small " + total);
        }
        System.out.println(sum(/* a */ 2, 3 /* b */));
        int x = 1;
        x++; // счётчик
        // комментарий перед пустым концом
        System.out.println("x=" + x); // последний
        // висящий комментарий в конце метода
    }
}
