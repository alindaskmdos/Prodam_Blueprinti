# analysis

Big O, символы размера, граф вызовов, детекторы дефектов (§8 ТЗ). Без Spring.

- `ProjectAnalysis.of(List<SourceFile>)` — разбор файлов (неразобранный файл пропускается, `warnings()`), индекс методов
  с теми же id, что в дереве проекта (`FQN.имя~N`, `FQN.<init>~N`), `callGraph()`, `methods()` / `method(id)`.
- `MethodAnalysis` — один метод: `complexity()` (Big O с вызовами методов проекта, мемоизация по графу),
  `confidence()` high/low + `warnings()` (рекурсия, while/do, нераспознанный размер — у себя или у вызываемых),
  `size(expr)`, `typeOf(var)`, `loopSize(loop)`, `enclosingLoops(node)`, `callCost(call)`, `callTarget(call)`, `span()`.
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
позитивный и негативный пример.

Зависит от: model, source. Тесты: `./gradlew :analysis:test` (в т.ч. прогон по `samples/demo` и `samples/roundtrip`).
