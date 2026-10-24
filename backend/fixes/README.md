# fixes

Quick-fix'ы и Quality Gate (§9 ТЗ).

Точки расширения: `Refactoring` (`canApply` / `apply`; пока над `Map<путь, исходник>`, перейдёт на ProjectSnapshot)
и `FixProvider` (сейчас только `id()`). Новый фикс = новый класс + регистрация. Только `LinkedHashMap`/`LinkedHashSet`.
Любой `Refactoring` обновляет ссылки во всех файлах проекта, включая `tests/*.java`.

**`QualityGate.apply(originalFiles, currentFiles, mainClass, refactoring, target)` → `Result`** (§9): `canApply`/`apply` →
компиляция программы (все `.java` вне `tests/`, в процессе через `javax.tools`, `-proc:none`) → проверка поведения
(конструктор берёт `Function<TestContext, VerifyResult>`, в app — `behaviorVerifier::verify`; JUnit-тесты компилирует он).
Входные карты не меняются: при отказе патч не возвращается (это и есть откат). Вердикт: `blocked`/`red`, не компилируется,
неприменим, исключение фикса → `applied=false`, `reason` «исправление не подтверждено: …» (`тест merge не проходит после
фикса`, `тест T не компилируется`); `incomplete` → применить, `reason` = «подтверждена компиляция, тестов нет» или
«применено, проверка неполная: <warnings>» (шум/нестабильный оригинал); `green` → применить, `reason` null.
`Result(applied, reason, changed, verify)` ложится на контрактный `FixResult`: `version`, `diff` (по `changed`) добавляет app;
`verify` = null, если до тестов не дошло.

Зависит от: model, source, analysis, testing.

Тесты: `./gradlew :fixes:test`.
