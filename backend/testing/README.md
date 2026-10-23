# testing

Источники тестов и проверка поведения (§10 ТЗ). Точка расширения: `TestSource` (`id()`, `run(TestContext)` → `List<TestResult>`),
реестр — `TestSourceRegistry.defaults(runner)` (сейчас `IoTestSource`; JUnit — BE-11).

- `TestContext` — файлы оригинала и текущей версии (путь как в проекте → текст) + main-класс. Программа = все `.java` вне `tests/`.
- `io.IoTestFiles` — `tests/<имя>.json` (§10.1): `load(files)` (тесты + понятные ошибки по файлам), `parse`, `validate`, `toJson`
  (для GET/PUT /tests). Пары `tests/x.in`/`x.out` → manual-тест `x`; без `.out` — original; json важнее пары.
- `io.IoTestSource` — весь прогон одним пакетом `Runner.runBatch` (один контейнер): каждый тест на текущей версии и на
  оригинале. original: эталон — оригинал; оригинал не компилируется/завис → `original_fails`. manual: эталон — `expected`;
  текущая не прошла и оригинал не прошёл → `original_fails`; текущая не прошла, оригинал прошёл → `failed`; текущая прошла,
  оригинал нет → `passed` с error «оригинал не проходит этот тест — правка его исправила»; оригинал не компилируется/завис —
  отдельный текст (у `passed` error — пояснение, не ошибка). Текущая не компилируется → `compile_error`; таймаут → `failed`/`timeout`; прогон прерван → `failed` с причиной.
- `io.OutputComparator` — правило §10.3: stdout побайтово (CRLF ≠ LF), exit code, тип+сообщение необработанного исключения
  (`Observed.uncaughtException`, stack trace не сравнивается); строки из множества `ignoredLines` пропускаются;
  обрезанный вывод (> 1 МБ) не совпадает никогда.
  BE-10: второй прогон оригинала — дополнительные `Job(1, stdin)` в том же пакете; «шумные» строки — в `ignoredLines`
  и в `TestResult.noisyLines`.

**Временные типы**: `TestResult`, `TestStatus`, `io.IoTestCase` повторяют контрактные `TestResult`/`TestCase` (поля и имена
те же, `wire()` — значения enum в JSON). После BE-05 заменяются record'ами из `model` одним адаптером.

Зависит от: model, runner, jackson-databind. Тесты: `./gradlew :testing:test` (Docker-тесты на `samples/roundtrip`
пропускаются, если `docker info` не проходит).
