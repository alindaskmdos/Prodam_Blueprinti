# analysis

Big O, символы размера, граф вызовов, детекторы дефектов (§8 ТЗ). Без Spring.

- `ProjectAnalysis.of(List<SourceFile>)` — разбор файлов (неразобранный файл пропускается, `warnings()`), индекс методов
  с теми же id, что в дереве проекта (`FQN.имя~N`, `FQN.<init>~N`), `callGraph()`, `methods()` / `method(id)`.
- `MethodAnalysis` — один метод: `complexity()` (Big O с вызовами методов проекта, мемоизация по графу),
  `confidence()` high/low + `warnings()` (рекурсия, while/do, нераспознанный размер — у себя или у вызываемых),
  `size(expr)`, `typeOf(var)`, `isFresh(symbol)`, `loopSize(loop)`, `enclosingLoops(node)`, `callCost(call)`, `callTarget(call)`, `span()`.
- `BigO` — алгебра: `plus` = максимум, `times`, `log`, `substitute` (параметр → символ аргумента), `ops(n)`;
  `toString()` — бейдж (`O(n²·m)`, символы → n, m, k…, первым — старшая степень, не больше 3 слагаемых),
  `raw()` — короткие имена символов. Ключи символов квалифицированы: поле — `FQN|поле`,
  параметр/локальная/нераспознанное — `methodId|имя`, чтобы символы вызываемого не сливались с чужими.
- `JdkCosts` — таблица стоимостей JDK по простому имени типа (объявленного или из `new`).
- `CallGraph` — callees/callers, рекурсия через компоненты сильной связности (`isRecursive`, `sameCycle`, `cycles`).
- Символы размера: параметр/поле — свой символ; копии, `subList`, stream-цепочки, `new ArrayList<>(a)` — тот же;
  `add` в цикле — размер цикла; `addAll` — сумма; нераспознанное — новый символ + предупреждение. Верхние оценки без потока.
- Ограничения: резолв типов текстовый (без Symbol Solver), перегрузки одной арности не различаются, стримы считаются
  только через `forEach`, поля классов — просто символ по имени.

Точка расширения: `Detector.detect(MethodAnalysis, ProjectAnalysis) -> List<Issue>`, реестр — `DetectorRegistry`
(`run(project)` — все проблемы). Новое правило = новый класс + строка в `DetectorRegistry.defaults()` + тест на
позитивный и негативный пример. `Issues.of(rule, severity, confidence, method, node, message, recommendation,
before, after)` — общая сборка Issue: id `rule:methodId:строка:колонка`, span по узлу, `blockId` = null (подставляет app по
диапазону строк), `fixes` пусты, ops при `Issues.DEFAULT_N` = 10 000.

Детекторы: `NestedLoopSameCollection` — вложенные циклы с общим символом размера (span — внутренний цикл,
while/do или нераспознанный (fresh) символ → confidence low; общий курсор вложенных while не считается; одноимённые коллекции разных классов не совпадают — символы квалифицированы).
`LinearSearchInLoop` — `contains/indexOf/lastIndexOf/remove(obj)` у списка (`JdkCosts.isList`) в цикле не константного
размера; span — вызов, severity medium; Set/Map/String/классы проекта не сообщаются, `remove` — только если аргумент
точно не индекс (new, строка, переменная не int/short/byte/char); неизвестный тип получателя (кроме `remove`),
`Collection` (`JdkCosts.isAbstractCollection`), remove(переменная неизвестного типа), fresh-размер списка или while/do → confidence low.
Отступление от §8.2: нераспознанное (fresh) число итераций и fresh-размер списка, выросшего от того же цикла, confidence не понижают — поиск по списку линеен в любом случае.
`ExpensiveCallInLoop` («N+1») — вызов с `callCost` ≥ O(n) (`BigO.isAtLeastLinear`: метод проекта или JDK по таблице) в цикле
не константного размера; span — вызов, severity medium. Не сообщаются: линейный поиск у списка (это `LinearSearchInLoop`),
O(log n), рекурсивный вызов (стоимость неизвестна) и вызов, у которого все символы стоимости «дешёвые»: данные элемента
for-each, если между его циклом и вызовом нет других неконстантных циклов (получатель `o.totalQty()` — нестатические поля
его класса; аргумент `checkLines(o)` — символы вызываемого от этого параметра), длины строк и целые параметры
(`padLeft(s, width)`; fresh-символ вызываемого — только от его скалярного параметра или счётного while/do/for, в условии
которого лишь строки/числа, как `do {…} while (true)`). Fresh от for-each по коллекции или результата вызова
(`isKnown(int id)` с обходом `catalog.items()`) не дешёвый. Иначе сообщается; fresh-символ (§8.2)
или вызываемый с confidence low → low; число итераций confidence не понижает.
`StringConcatInLoop` — `s += x` / `s = s + x` (s — крайний левый операнд) для String в цикле не константного размера;
считаются только циклы, переживаемые строкой (объявлена вне цикла или в init этого for; локальная из тела цикла не
выходит из итерации). Одна находка на внешний такой цикл, span — этот цикл, все переменные — в message; before O(L²) →
after O(L), severity medium. Неизвестный тип хоть одной переменной (унаследованное поле, `var` не от литерала/`new`) → low;
известный не String — молчит; число итераций confidence не понижает. Prepend `s = x + s` не сообщается (§8.3: `s += …`).
Для фикса: `StringConcatInLoop.concats(method)` → `List<Concat>` (присваивание, переменная, объявление или null для
поля/параметра, внешний цикл, число итераций, тип известен) — те же правила, что у детектора; фильтровать по `loop`.
`ProjectAnalysis.isInstanceField(FQN|поле)` — нестатическое поле класса проекта.

Метрики метода (для `MethodMetrics` контракта): `MethodAnalysis.lines()` — диапазон объявления от сигнатуры
(с аннотациями, без javadoc) до `}` включительно, пустые строки и комментарии в счёт (как `span()`);
`maxNesting()` — глубина вложенности: тело метода — уровень 1 (метод без конструкций = 1, как в фикстуре контракта),
каждая if/for/for-each/while/do/switch (оператор и выражение)/try/synchronized добавляет уровень; else-if не углубляет,
лямбда прозрачна (её тело на уровне лямбды), тела анонимных и локальных классов не считаются (аргументы `new X(…) {…}` — считаются);
`deepestConstruct()` — первая из самых глубоких конструкций или null.
`LongMethod` — `lines() > LongMethod.MAX_LINES` (50: больше экрана; при 40 шумел плоский диспетчер `Main.dispatch` в demo — 50 строк);
span — объявление метода. `DeepNesting` — `maxNesting() > DeepNesting.MAX_NESTING` (4: тело + цикл/цикл/условие ещё читаются);
одна находка на метод, span — `deepestConstruct()`. Оба: severity low, confidence high, без complexity и fixes, рекомендация «Выделить метод».
На demo: LongMethod — `ReportService.fullReport` (56 строк), DeepNesting — `ReportService.hotProducts` (7 уровней); `OrderService.merge` — 19 строк, 4 уровня.

Зависит от: model, source. Тесты: `./gradlew :analysis:test` (в т.ч. прогон по `samples/demo` и `samples/roundtrip`).
