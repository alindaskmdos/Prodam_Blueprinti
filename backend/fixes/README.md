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

Реестр: `RefactoringRegistry.defaults()` / `byId(id)`; id фикса — значение для `Issue.fixes`.
Фиксы (target — id находки `rule:methodId:строка:колонка`):
- `StringBuilderFix` (`string-builder`, для `StringConcatInLoop`): переменные берёт из `StringConcatInLoop.concats`;
  `StringBuilder sSb = new StringBuilder(s);` перед циклом, `s += x` → `sSb.append(x)`, `s = s + a + b` →
  `sSb.append(a).append(b)`, `s = sSb.toString();` сразу после цикла; правятся только эти диапазоны, перевод строки файла
  сохраняется. Узкий шаблон (иначе `canApply=false`): локальная String объявлена до цикла и не null (литерал/конкатенация),
  в цикле встречается только в своих конкатенациях-операторах, цикл — оператор блока на своей строке, без меток и
  labeled break/continue, без try между объявлением и циклом, аргумент не переменная-массив (`char[]`).

Зависит от: model, source, analysis, testing.

Тесты: `./gradlew :fixes:test`.
