# analysis

Big O, символы размера, граф вызовов, детекторы дефектов (§8 ТЗ). Без Spring.

- `ProjectAnalysis.of(List<SourceFile>[, long n])` — n (≥ 1, по умолчанию `Issues.DEFAULT_N` = 10 000, `n()`) — размер входа для ops проблем; разбор файлов (неразобранный файл пропускается, `warnings()`), индекс методов
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
диапазону строк), `fixes` пусты, ops (`BigO.ops`) при `n()` проекта метода.

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
`DeadCode` (§14а.3) — только уверенные находки: приватный метод без вызова/ссылки `::` по имени в своём top-level классе
(самовызов не в счёт; low/high; имя есть в строковом литерале проекта — возможно, рефлексия — confidence low), локальная
переменная-оператор без единого `NameExpr` с её именем и без ссылки на метод `имя::m` (low/high), оператор после return/throw/break/continue/yield в том же
блоке/case (medium/high). Не сообщаются: неприватные методы (их могут звать tests/*.java, внешний код, рефлексия), main,
toString/equals/hashCode/compareTo, приватные методы сериализации (writeObject/readObject/readObjectNoData/readResolve/writeReplace), методы с аннотациями (кроме Deprecated/SuppressWarnings/SafeVarargs), конструкторы,
переменные for/for-each/try/catch. Перегрузки и лямбды — по имени. Поля и классы не проверяются (у Issue без метода нет blockId).
На demo находок нет. `ProjectAnalysis.stringLiterals()` — значения строковых литералов проекта.

UML (§14а.1): `ProjectAnalysis.uml()` → `UmlModel` — `classes()` (`Clazz`: id = FQN через точки, вложенный `pkg.Outer.Inner`,
name `Outer.Inner`, kind, pkg, path, span, modifiers, typeParams, поля включая компоненты record, конструкторы/методы с id как в дереве
(`FQN$Inner.имя~N`), сигнатура — объявленные модификаторы + заголовок), `relations()` — только между классами проекта, на пару одна
самая сильная: extends/implements > composition > aggregation > association > dependency. Поле: коллекция/массив/Map (по значению) →
aggregation «*»; присвоено `new` → composition; из параметра конструктора или компонент record → aggregation; иначе association «1».
dependency — тип/статическое обращение в методе, конструкторе или объявлении поля (via — первый такой член по порядку). Резолв имён
текстовый: параметры типа, вложенные своего и внешних классов, single-импорт, свой пакет, импорт `*`, полное имя. `nested(a, b)` —
внешний/вложенный. Ограничения: унаследованные вложенные типы и статические импорты не резолвятся, `Outer.Inner.X` в выражении даёт только Outer.

Граф зависимостей (§14а.4): `ProjectAnalysis.dependencies()` → `DependencyGraph` — nodes (классы UML), edges (все связи UML без
внешний ↔ вложенный и петель; `inCycle` — оба конца в одной компоненте), cycles (сильно связные компоненты 2+ классов через Тарьяна
`CallGraph`; classes в порядке узлов, severity 2 → low, 3+ → medium, issueId = `CyclicDependency:<FQN первого>`).
Детектор уровня проекта: `Detector.detectProject(project)` (по умолчанию пусто), `DetectorRegistry.run` зовёт его после методов.
`CyclicDependency` — Issue на каждый цикл: без methodId/blockId, classIds, span — объявление первого класса, confidence high,
message с маршрутом `A → B → A`, без фиксов.

PMD (§14а.2): `PmdDetector` (уровень проекта, PMD 7 из `libs.versions.toml`) — прогон PMD по `ProjectAnalysis.files()` с ruleset
проекта; регистрируется только в `DetectorRegistry.defaults(String pmdRuleset)` (app), `defaults()` — встроенные детекторы без PMD
(CLI и тесты детекторов). `PmdDetector.DEFAULT_RULESET` — ресурс `blueprints/analysis/pmd-ruleset.xml`, текст равен
`contract/fixtures/pmd-config.default.json` (выключены правила, дублирующие наши детекторы). Находка: source=PMD, rule — имя правила PMD,
severity по приоритету (1–2 high, 3 medium, 4–5 low), confidence high, без fixes; id `PMD:<правило>:<methodId|FQN класса>:строка:колонка`
(дубль — `#n`). Привязка по строке начала: самый вложенный метод файла → methodId (blockId подставляет app), иначе самый вложенный
класс → classIds (вне классов, напр. import, — первый класс файла; файл без классов — находка отбрасывается), span — строки нарушения. Порядок — файлы проекта, затем позиция. Кэш LRU на 32 снимка по SHA-256 ruleset+исходников
(прогон ~1 с). Таймаут (защита от ReDoS в regex-свойствах и include/exclude-pattern): прогон PMD целиком и загрузка ruleset в `validate`
идут в демон-потоках, не больше 2 одновременно на всё приложение (семафор `PERMITS`, без очереди), с ограничением `PmdDetector.DEFAULT_TIMEOUT` (15 с; первый прогон
в JVM ~6 с). По таймауту анализ без находок PMD (предупреждение — в лог, места в контракте нет), результат не кэшируется, а ruleset
(SHA-256 текста, LRU на 32) попадает в список неудач: больше не запускается, `validate` его отклоняет; стандартный набор туда не
попадает (его таймаут — от размера проекта). java.util.regex не реагирует на interrupt: зависший поток дорабатывает сам и держит разрешение. Любое исключение или Error из прогона PMD — тоже анализ без находок PMD + лог, не 500 (не попадает в список неудач). Пока оба
потока заняты (чужие прогоны или зависшие regex), снимок любого проекта сразу (без ожидания) идёт без находок PMD — остальные
пользователи видят анализ без PMD, остальные детекторы работают; `validate` отвечает «анализатор PMD сейчас занят — повторите позже».
Если оба потока повисли навсегда — PMD молчит до рестарта (надёжнее — отдельный процесс). `load` повторяет `checkXml` перед
загрузкой (ref, подменённый файлом после validate). `PmdDetector.validate(xml)` → `InvalidRulesetException` (message, line или null): битый XML/DOCTYPE, корень не `<ruleset>`,
`ref` не из classpath PMD (`category/…/*.xml[/Rule]`, `rulesets/…`), свои правила (`class`, в т.ч. XPathRule) и любое свойство с `xpath` в имени без учёта регистра — атрибут `name` или вложенный `<name>` (`xpath`, `violationSuppressXPath`:
XPath на Saxon читает файлы/URL — doc, unparsed-text…), любой атрибут с `xpath` в имени, пролог с encoding не UTF-8 (checkXml разбирает те же
UTF-8 байты, что PMD), `ref`, совпадающий с файлом относительно рабочей папки (PMD ищет ссылку сначала в файлах, потом в classpath), неизвестное правило
(загрузка самим PMD). Без сети: ruleset и правила только из jar PMD.

Зависит от: model, source. Тесты: `./gradlew :analysis:test` (в т.ч. прогон по `samples/demo` и `samples/roundtrip`).
