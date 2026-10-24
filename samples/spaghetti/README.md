# samples/spaghetti

Пример человека для LongMethod и LongLine: `SpaghettiCodeExample.java` (пакет по умолчанию, свой `main`, stdin не читает,
вывод детерминированный, кириллица — UTF-8). Файл хранится **байт в байт** — не править. Отдельным проектом, потому что
verify требует единственный `main` (иначе 422 AMBIGUOUS_MAIN).

## Ожидаемые находки (закреплены `DetectorsSampleTest` в analysis)

| Метод:строка | Правило |
|---|---|
| `processComplexPipeline`:15 (49 строк, порог 30) | LongMethod |
| `processComplexPipeline`:39 (269 символов; длинных строк в методе — 4: 24, 39, 49, 58) | LongLine |
| `processComplexPipeline`:49 (low) | LinearSearchInLoop — известное ложное срабатывание старого детектора: `String.contains` у цепочки строковых вызовов принят за поиск по списку |

## Тесты

`tests/run.in` (пустой) / `tests/run.out` — IO-тест, `.out` получен реальным запуском.
Прогнать: `bash samples/spaghetti/run-tests.sh`, `--regen` перезаписывает `.out`.
