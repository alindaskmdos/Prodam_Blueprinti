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
- `LinkedHashSetFix` (`linked-hash-set`, для `LinearSearchInLoop`, только `contains`): находку проверяет детектором;
  `Set<T> xsSet = xs == null ? null : new LinkedHashSet<>(xs);` перед ближайшим циклом (NPE там же, где раньше), все
  `xs.contains(e)` цикла → `xsSet.contains(e)`, импорт `java.util.LinkedHashSet/Set` после последнего импорта, если не
  покрыт (`java.util.*`). Узкий шаблон (иначе `canApply=false`): тип объявлен `List/ArrayList/LinkedList<T>`, T — String/
  обёртка примитива; аргумент `contains` — примитив или ровно T (литерал, переменная, приведение); в цикле список — только
  получатель `contains`; цикл — оператор блока на своей строке, вызов не в лямбде/анонимном классе; имя `Set`/
  `LinkedHashSet` не занято другим типом. Локальная, которой присваивается только `new ArrayList/LinkedList`, нигде в методе
  не уходит (только вызовы её методов кроме view: subList/reversed/iterator/listIterator/descendingIterator/spliterator; for-each, return, присваивание ей). Всё остальное (поле,
  параметр, значение из вызова или другой переменной — возможный алиас): в цикле нет других вызовов, `new`, лямбд —
  поэтому к demo `InventoryService.watched` (параметр, `p.getId()`/`result.add` в цикле) фикс не применяется.
  Ограничения: снимок поля/списка, который меняет другой поток во время цикла, не отслеживается.
  Неявный код в цикле (toString при конкатенации, iterator() пользовательского Iterable в for-each) не учитывается.
  Тип аргумента `contains` берётся по имени в методе — при переобъявлении имени с другим типом в соседней области возможна ошибка.

Общие операции над текстом фиксов (позиции → смещения, правки диапазонов, исходники для анализа) — `FixText`.

Зависит от: model, source, analysis, testing.

Тесты: `./gradlew :fixes:test`.
