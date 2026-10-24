# samples/detectors

Пример-проект для правил EmptyCatch, CatchBug, IgnoredResult, ReferenceEquality: по мини-сервису на правило (LongMethod/LongLine —
в `samples/spaghetti`, отдельно: один `main` на проект для verify). Чистая JDK 21, пакет по умолчанию,
точка входа `Main` — по строке stdin имя примера (`empty-catch`, `catch-bug`, `ignored`, `equality`, `all`),
вывод детерминированный (LF). Вывод показывает баги: порт `80O` молча стал 8080, налог не прибавлен, `1000 == 1000 -> false`.
В исходниках позитивы помечены `// ожидается: <Rule>`, негативы — `не находка: почему`.

## Ожидаемые находки (закреплены `DetectorsSampleTest` в analysis)

| Файл | Метод:строка | Правило |
|---|---|---|
| ConfigLoader.java | `port`:27 (high), `retries`:37 (только комментарий, low), `workerPorts`:51 (в лямбде) | EmptyCatch |
| OrderImporter.java | `customerOf`:20 (AIOOBE, medium), `cityOf`:30 (NPE, medium), `importAll`:44 (Throwable, high) | CatchBug |
| InvoiceService.java | `header`:13 (`trim`), `totalWithTax`:21 (`BigDecimal.add`), `dueDate`:28 (`LocalDate.plusDays`) | IgnoredResult |
| StockChecker.java | `integerCache`:23 и :24 (Integer 127 / 1000), `matches`:30, `isReserved`:37 (String) | ReferenceEquality |

Негативы (молчат): catch с логом / пробросом / NumberFormatException, `s = s.trim()`, лямбда в `map`, `StringBuilder.append`,
`case -> expr` switch-выражения, `qty == 5`, `== null`, enum, `Objects.equals`, примитивы.

## Тесты

`tests/*.in` / `tests/*.out` — IO-тесты (§10.1), `.out` получены реальным запуском.
Прогнать: `bash samples/detectors/run-tests.sh` (`javac` + сравнение вывода), `--regen` перезаписывает `.out`.
