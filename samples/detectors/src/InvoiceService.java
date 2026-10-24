import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** Выставление счетов: имя клиента, сумма с налогом, срок оплаты. Правило: IgnoredResult. */
public class InvoiceService {
    private static final BigDecimal TAX_RATE = new BigDecimal("0.20");

    /** Результат trim() выброшен — в счёт попадает имя с пробелами. */
    public String header(String customer) {
        customer.trim(); // ожидается: IgnoredResult (String.trim)
        return "Invoice for [" + customer + "]";
    }

    /** BigDecimal неизменяем: add() возвращает новую сумму, а total остаётся без налога. */
    public BigDecimal totalWithTax(BigDecimal net) {
        BigDecimal total = net;
        BigDecimal tax = net.multiply(TAX_RATE).setScale(2, RoundingMode.HALF_UP);
        total.add(tax); // ожидается: IgnoredResult (BigDecimal.add)
        return total;
    }

    /** LocalDate неизменяем: plusDays() не сдвигает дату — срок оплаты совпадает с датой счёта. */
    public LocalDate dueDate(LocalDate issued) {
        LocalDate due = issued;
        due.plusDays(30); // ожидается: IgnoredResult (LocalDate.plusDays)
        return due;
    }

    /** не находка: результат присвоен обратно (s = s.trim()). */
    public String fixedHeader(String customer) {
        customer = customer.trim();
        return "Invoice for [" + customer + "]";
    }

    /** не находка: тело лямбды-выражения — это значение map(), а не отброшенный результат. */
    public List<String> normalizedNames(List<String> names) {
        return names.stream().map(n -> n.trim().toUpperCase()).toList();
    }

    /** не находка: StringBuilder и ArrayList изменяемы, результат append()/add() не нужен. */
    public String lines(List<String> items) {
        StringBuilder sb = new StringBuilder();
        List<String> seen = new ArrayList<>();
        for (String item : items) {
            sb.append("- ").append(item).append('\n');
            seen.add(item);
        }
        return sb + "(" + seen.size() + " items)";
    }

    /** не находка: ветка case X -> expr у switch-выражения — значение, а не оператор. */
    public String label(String code, int kind) {
        String label = switch (kind) {
            case 1 -> code.toUpperCase();
            case 2 -> code.toLowerCase();
            default -> code;
        };
        return label;
    }

    public static void demo() {
        InvoiceService invoices = new InvoiceService();
        System.out.println(invoices.header("  ACME Corp  "));
        System.out.println(invoices.fixedHeader("  ACME Corp  "));
        System.out.println("total=" + invoices.totalWithTax(new BigDecimal("100.00")) + " (expected 120.00)");
        System.out.println("due=" + invoices.dueDate(LocalDate.of(2026, 1, 15)) + " (expected 2026-02-14)");
        System.out.println(invoices.normalizedNames(List.of(" widget ", "gadget  ")));
        System.out.print(invoices.lines(List.of("widget", "gadget")));
        System.out.println();
        System.out.println(invoices.label("Sku-7", 1) + " " + invoices.label("Sku-7", 2));
    }
}
