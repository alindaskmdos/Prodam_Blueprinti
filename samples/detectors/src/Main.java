import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;

/** Точка входа: по строке stdin — имя примера (empty-catch, catch-bug, ignored, equality, all). */
public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = in.readLine()) != null) {
            String command = line.strip();
            if (!command.isEmpty()) {
                System.out.println("== " + command);
                run(command);
            }
        }
    }

    static void run(String command) {
        switch (command) {
            case "empty-catch" -> ConfigLoader.demo();
            case "catch-bug" -> OrderImporter.demo();
            case "ignored" -> InvoiceService.demo();
            case "equality" -> StockChecker.demo();
            case "all" -> {
                for (String name : new String[] {"empty-catch", "catch-bug", "ignored", "equality"}) {
                    run(name);
                }
            }
            default -> System.out.println("unknown example: " + command);
        }
    }
}
