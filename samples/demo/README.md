# samples/demo

Демо-монолит «магазин»: клиенты, склад, заказы, отчёты. Чистая JDK 21, без зависимостей, точка входа `com.demo.Main`
(команды из stdin, детерминированный вывод, всегда LF). Пакеты: `com.demo.model`, `com.demo.service`, `com.demo.util`.
Намеренно содержит конструкции для round-trip: for/foreach/while/do, switch, try/catch/finally, лямбды, anonymous/nested class,
enum с телом, record, interface, generics.

## Заложенные дефекты

| Файл | Метод | Дефект |
|---|---|---|
| service/OrderService.java | `merge` | NestedLoopSameCollection: O(n·n) по `orders`, сравнение `customerId` |
| service/InventoryService.java | `watched` | LinearSearchInLoop: `List.contains` в цикле |
| service/InventoryService.java | `distinctIds` | LinearSearchInLoop: `List.indexOf` в цикле |
| service/Validator.java | `checkLines` | LinearSearchInLoop: `seen.contains` в цикле |
| util/Texts.java | `join` | StringConcatInLoop: `out += ...` |
| service/ReportService.java | `fullReport` | StringConcatInLoop (`report += ...`) и LongMethod (> 50 строк) |
| service/ReportService.java | `hotProducts` | DeepNesting: вложенность 5 |

## Тесты

`tests/*.in` / `tests/*.out` — IO-тесты (пары по §10.1 ТЗ, подхватываются автоматически); `.out` получены реальным запуском.
Прогнать: `bash samples/demo/run-tests.sh` (компиляция `javac` + сравнение вывода). `--regen` перезаписывает `.out`.
