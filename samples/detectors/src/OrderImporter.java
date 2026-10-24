import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Импорт заказов из CSV-строк "id;customer;qty;total". Правило: CatchBug. */
public class OrderImporter {
    private final Map<String, String> customerCities = new LinkedHashMap<>();

    public OrderImporter() {
        customerCities.put("alice", "Berlin");
        customerCities.put("bob", "Paris");
    }

    /** Нет поля в строке — баг формата выдаётся за «неизвестного клиента». */
    public String customerOf(String csv) {
        String[] fields = csv.split(";");
        // ожидается: CatchBug (ArrayIndexOutOfBoundsException, severity medium)
        try {
            return fields[1];
        } catch (ArrayIndexOutOfBoundsException e) {
            return "unknown";
        }
    }

    /** Клиента нет в справочнике — NPE ловится и превращается в пустой город, баг не виден. */
    public String cityOf(String customer) {
        // ожидается: CatchBug (NullPointerException, severity medium)
        try {
            return customerCities.get(customer).toUpperCase();
        } catch (NullPointerException e) {
            return "";
        }
    }

    /** Перехват Throwable глотает и OutOfMemoryError, и StackOverflowError. */
    public int importAll(List<String> rows) {
        int imported = 0;
        for (String row : rows) {
            // ожидается: CatchBug (Throwable, severity high)
            try {
                System.out.println("import " + customerOf(row) + " from " + cityOf(customerOf(row))
                        + " avg=" + averagePrice(row));
                imported++;
            } catch (Throwable t) {
                System.out.println("skip row: " + t.getMessage());
            }
        }
        return imported;
    }

    /** не находка: ArithmeticException пробрасывается обёрнутой, баг не маскируется. */
    public long averagePrice(String csv) {
        String[] fields = csv.split(";");
        if (fields.length < 4) {
            throw new IllegalArgumentException("short row: " + csv);
        }
        try {
            return Long.parseLong(fields[3]) / Long.parseLong(fields[2]);
        } catch (ArithmeticException e) {
            throw new IllegalArgumentException("zero quantity in " + csv, e);
        }
    }

    /** не находка: NumberFormatException — ожидаемая ошибка ввода, не баг программы. */
    public int quantityOf(String csv) {
        String[] fields = csv.split(";");
        try {
            return Integer.parseInt(fields.length > 2 ? fields[2] : "0");
        } catch (NumberFormatException e) {
            System.out.println("WARN bad quantity in " + csv);
            return 0;
        }
    }

    public static void demo() {
        OrderImporter importer = new OrderImporter();
        List<String> rows = List.of("1;alice;2;300", "2;carol;1;50", "3;bob;0;10", "4");
        System.out.println("customer of '4' = " + importer.customerOf("4"));
        System.out.println("city of carol = '" + importer.cityOf("carol") + "'");
        System.out.println("quantity of '5;bob;x;1' = " + importer.quantityOf("5;bob;x;1"));
        System.out.println("imported " + importer.importAll(rows) + " of " + rows.size());
    }
}
