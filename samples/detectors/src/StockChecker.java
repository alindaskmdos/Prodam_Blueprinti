import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/** Сверка остатков склада с заказами. Правило: ReferenceEquality. */
public class StockChecker {
    enum Level { LOW, NORMAL, HIGH }

    private final Map<String, Integer> stock = new LinkedHashMap<>();

    public StockChecker() {
        stock.put("bolt", 127);
        stock.put("nut", 1000);
    }

    /**
     * Классика: Integer кешируется только в диапазоне -128..127, поэтому 127 == 127 — true,
     * а 1000 == 1000 — false: сравниваются ссылки, а не числа.
     */
    public static void integerCache() {
        Integer a = 127, b = 127;
        Integer c = 1000, d = 1000;
        System.out.println("127 == 127 -> " + (a == b)); // ожидается: ReferenceEquality
        System.out.println("1000 == 1000 -> " + (c == d)); // ожидается: ReferenceEquality
    }

    /** Остаток из Map — Integer: на 127 сверка проходит, на 1000 — нет. */
    public boolean matches(String sku, Integer ordered) {
        Integer inStock = stock.get(sku);
        return inStock == ordered; // ожидается: ReferenceEquality
    }

    /** Строка, собранная во время работы, — другой объект, чем литерал. */
    public boolean isReserved(String sku) {
        String status = new StringBuilder("RES").append("ERVED").toString();
        String expected = "RESERVED";
        return sku != null && status == expected; // ожидается: ReferenceEquality (status == expected)
    }

    /** не находка: сравнение с примитивом — анбоксинг, сравниваются числа. */
    public boolean isFive(String sku) {
        Integer qty = stock.get(sku);
        return qty != null && qty == 5;
    }

    /** не находка: сравнение с null и enum по ссылке — корректно. */
    public Level level(String sku) {
        Integer qty = stock.get(sku);
        if (qty == null) {
            return Level.LOW;
        }
        Level level = qty > 500 ? Level.HIGH : Level.NORMAL;
        return level == Level.HIGH ? Level.HIGH : level;
    }

    /** не находка: правильные варианты — equals / Objects.equals / примитивы. */
    public boolean matchesFixed(String sku, Integer ordered) {
        Integer inStock = stock.get(sku);
        int have = inStock == null ? 0 : inStock;
        int want = ordered;
        return Objects.equals(inStock, ordered) && have == want && sku.equals(sku.strip());
    }

    public static void demo() {
        integerCache();
        StockChecker checker = new StockChecker();
        System.out.println("bolt 127 matches: " + checker.matches("bolt", 127));
        System.out.println("nut 1000 matches: " + checker.matches("nut", 1000));
        System.out.println("nut 1000 matchesFixed: " + checker.matchesFixed("nut", 1000));
        System.out.println("bolt reserved (expected true): " + checker.isReserved("bolt"));
        System.out.println("nut is five: " + checker.isFive("nut"));
        System.out.println("levels: " + checker.level("bolt") + " " + checker.level("nut")
                + " " + checker.level("gear"));
    }
}
