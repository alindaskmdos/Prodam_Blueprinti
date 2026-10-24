import java.util.ArrayList;
import java.util.List;

public class SpaghettiCodeExample {

    public static void main(String[] args) {
        System.out.println("Старт спагетти-метода...");
        processComplexPipeline("   !!!user_name:admin;role:manager;status:active;id:999!!!   ");
        System.out.println("Конец программы.");
    }

    /**
     * Длинный метод (более 35 строк) со сверхдлинными цепочками вызовов функций.
     */
    public static void processComplexPipeline(String inputString) {
        System.out.println("Шаг 1: Инициализация входного потока данных");
        
        if (inputString == null) {
            System.out.println("Ошибка: Входная строка равна null");
            return;
        }

        // Крайне длинная спагетти-строка №1 через цепочку вызовов методов String
        String cleanData = inputString.trim().replace("!!!", "").replace(" ", "").toLowerCase().substring(0, inputString.trim().replace("!!!", "").replace(" ", "").length() - 3).toUpperCase().concat("_VALIDATED").substring(2).trim().toLowerCase();
        
        System.out.println("Результат первой очистки: " + cleanData);
        System.out.println("Шаг 2: Расщепление строки на массив и фильтрация элементов");

        String[] parts = cleanData.split(";");
        List<String> list = new ArrayList<>();
        
        for (String part : parts) {
            list.add(part);
        }

        System.out.println("Шаг 3: Запуск конвейера трансформации над коллекцией");

        // Крайне длинная спагетти-строка №2: Бесконечные склейки, замены и преобразования без промежуточных переменных
        String finalReport = list.toString().replace("[", "").replace("]", "").trim().toUpperCase().concat(";SYSTEM:OK").replace("ROLE", "POSITION").substring(0, list.toString().length() / 2).trim().concat("...").replace(":", " -> ").toUpperCase().toLowerCase().trim();

        System.out.println("Промежуточный отчет: " + finalReport);
        System.out.println("Шаг 4: Дополнительные циклические проверки объема");

        int counter = 0;
        for (int i = 0; i < parts.length; i++) {
            String element = parts[i];
            
            // Спагетти-цепочка №3 внутри цикла
            if (element.trim().toUpperCase().replace("ID", "IDENTIFIER").contains("IDENTIFIER") || element.toLowerCase().trim().startsWith("user")) {
                System.out.println("Найден важный ключ: " + element.toUpperCase().trim().substring(0, 4).concat("..."));
                counter++;
            }
        }

        System.out.println("Шаг 5: Формирование финального статуса выполнения");
        
        // Спагетти-цепочка №4
        String executionStatus = "Status: ".concat(finalReport).trim().replace(" ", "_").toUpperCase().substring(0, Math.min(30, finalReport.length())).concat("_SUCCESS_FINAL");
        
        System.out.println("Финальный лог: " + executionStatus);
        System.out.println("Количество совпадений по ключам: " + counter);
        System.out.println("Метод успешно завершил свой длинный жизненный цикл.");
    }
}
