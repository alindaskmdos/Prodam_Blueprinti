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
- `IndexByIdFix` (`index-by-id`, для `NestedLoopSameCollection`, как `OrderService.merge`): находку проверяет детектором;
  `for (i…) { T a = xs.get(i); if (!a.getS().m()) continue; for (j = i + 1…) { T b = xs.get(j); if (b.getS().m() && a.getK() == b.getK()) {BODY} } }`
  → `Map<K, T> byK = new LinkedHashMap<>();` перед циклом, один проход: `T b = xs.get(i); if (!b.getS().m()) continue;
  T a = byK.putIfAbsent(b.getK(), b); if (a != null) {BODY}` (первый живой элемент ключа поглощает следующие — как в оригинале;
  BODY переносится текстом, импорты `Map/LinkedHashMap` при необходимости). Порядок тел внутри ключа тот же, между ключами
  меняется — поэтому `canApply` требует: K — геттер final-поля примитива (`==` на обёртках — нет); S — геттер поля-enum'а
  проекта без тел у констант, m — `return` из `this ==/!= C`, `!`, `&&`, `||`; T — класс проекта без наследников; в BODY
  верхнеуровневый `b.setS(E.C)` с m(C) = false; весь BODY (рекурсивно через методы T, record'ов/enum'ов и private/static
  методы владельца) проходит белый список: пишет только не-final поля a/b значениями (поле S — только у b и «мёртвой»
  константой), меняет только свои final-коллекции a/b из `new ArrayList/LinkedList` с неизменяемыми элементами (примитивы,
  String, обёртки, enum'ы, record'ы из них) через get/size/isEmpty/add/set; счётчики метода — только `x++/x--` без чтения в
  цикле. Запрещены поля/this владельца, i/j, break/continue/return на уровне BODY, throw/try/switch/лямбды, static-вызовы,
  методы JDK у значений, свой toString в конкатенации. Геттеры K/S — `return поле;` с типом возврата ровно как у поля;
  у T нет наследников и анонимных подклассов `new T(…) {…}` в проекте; `List/ArrayList/LinkedList` — только если в проекте
  нет своего типа с таким именем. Ограничения: при исключении во время цикла (NPE от null-элемента или null из геттера S,
  ArithmeticException от `/0`/`%0`, IndexOutOfBounds у get/set своей коллекции) исключение сохраняется, но набор уже
  выполненных тел до него может отличаться; реализация `List` считается JDK (get/size без эффектов).

Общие операции над текстом фиксов (позиции → смещения, правки диапазонов, импорты java.util, исходники для анализа) — `FixText`.

Зависит от: model, source, analysis, testing.

Тесты: `./gradlew :fixes:test`.
