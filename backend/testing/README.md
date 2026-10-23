# testing

Источники тестов и проверка поведения (§10 ТЗ). Точка расширения: `TestSource` (`id()`, `run(TestContext)` → `List<TestResult>`;
для общего контейнера — `prepare(ctx, Batch)` → `Prepared`, по умолчанию отдельный `run`; `providesInput(ctx)` — есть тест со входом),
реестр — `TestSourceRegistry.defaults(runner)` (`IoTestSource`, `JUnitTestSource`).

- **`BehaviorVerifier.verify(ctx)` → `VerifyResult`** (§10.3–10.5, POST /verify): все источники реестра кладут запуски в один
  `Batch` → один `runBatch` (`Rewrite.RUN`, seed для текущей и оригинала) — один контейнер. IO: оригинал гоняется дважды,
  различающиеся строки (`Noise`; строки без пары при разной длине тоже шумные) не сравниваются и идут в `noisyLines`.
  Статус: `blocked` (текущая читает stdin — `StdinUsage`: `System.in`/`System.console()` вне комментариев и литералов, — а
  непустого stdin ни у одного теста нет; тесты не запускаются) > `red` (хоть один не `passed`) > `incomplete` (шумных строк
  > половины вывода хоть в одном тесте, или тестов нет — подсказка «Тестов пока нет…») > `green`. Warnings: шум, «N тестов пропущено (@Disabled)».
  Разный exit code/исключение у двух прогонов оригинала → тест не red (сравнивается только stdout), verify — `incomplete` + warning с именами тестов.

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
  Шумные строки BE-10 передаются сюда вместе с `ignoreLines`. `IoTestSource.run` гоняет оригинал один раз (без шума).
- `junit.JUnitTestSource` (§10.2) — `tests/*.java` текущей версии компилируются вместе с программой (пакет — из `package`
  теста) с `Rewrite.JUNIT` (`private` → package-private) только в копии; запуск — `junit-platform-console-standalone`
  (jar в ресурсах модуля из `libs.versions.toml`, монтируется read-only в `/opt/junit`), один command-`Job` на все тесты,
  таймаут — `Config.commandTimeout()` (30 с на весь запуск, IO — по 10 с), stdout запуска — XML-отчёт
  (`junit.JUnitReport`: имя `полное.имя.Класса.метод`, в пакете по умолчанию — `Класс.метод`, failure/error → `failed` с сообщением без stack trace,
  skipped → `passed` с «пропущен»). Не компилируются тесты или программа → `compile_error` у каждого тестового класса
  (текст «тесты не компилируются»/«код программы не компилируется» + ошибки); таймаут/нет отчёта → `failed`.
  `plan(ctx, index)`/`results(plan, runResult)` — основа `prepare`: программа + job + `files` в общем пакете.
  Оговорки: снятие `private` регуляркой может сломать корректный код (private-метод подкласса с той же сигнатурой, что у
  суперкласса, становится package-private и сужает доступ) — пользователь увидит «код программы не компилируется».
  Отчёт пишется в `/tmp` контейнера, доступный коду теста: тест может его подменить — модель «пользователь проверяет сам себя».

**Временные типы**: `TestResult`, `TestStatus`, `VerifyResult`, `io.IoTestCase` повторяют контрактные `TestResult`/`VerifyResult`/`TestCase` (поля и имена
те же, `wire()` — значения enum в JSON). После BE-05 заменяются record'ами из `model` одним адаптером.

Зависит от: model, runner, jackson-databind. Тесты: `./gradlew :testing:test` (Docker-тесты — IO на `samples/roundtrip`,
JUnit и `BehaviorVerifierDockerTest` — пропускаются, если `docker info` не проходит).
