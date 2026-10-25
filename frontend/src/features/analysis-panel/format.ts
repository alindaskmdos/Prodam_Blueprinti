import type { Schemas } from '../api';
import { shortMethodName } from '../layout';

type Issue = Schemas['Issue'];
type Severity = Schemas['Severity'];

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export const SEVERITY_LABEL: Record<Severity, string> = { high: 'высокая', medium: 'средняя', low: 'низкая' };

/** Сортировка по серьёзности (high → medium → low), затем по файлу и строке. Исходный массив не меняется. */
export function sortBySeverity(issues: readonly Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.span.file.localeCompare(b.span.file) ||
      a.span.startLine - b.span.startLine,
  );
}

/** Вкладка «Проблемы» — confidence high, «Предупреждения» — confidence low (контракт, Analysis.issues). */
export function splitIssues(issues: readonly Issue[]): { problems: Issue[]; warnings: Issue[] } {
  return {
    problems: sortBySeverity(issues.filter((i) => i.confidence === 'high')),
    warnings: sortBySeverity(issues.filter((i) => i.confidence === 'low')),
  };
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function superscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => (d === '-' ? '⁻' : (SUPERSCRIPT[Number(d)] ?? d)))
    .join('');
}

/**
 * Порядок числа операций из контракта (opsBefore/opsAfter): 100000000 → «≈10⁸», 20000 → «≈2·10⁴», 350 → «≈350».
 * Только форматирование готового числа, ничего не досчитывается.
 */
export function formatOps(ops: number): string {
  if (!Number.isFinite(ops) || ops < 0) return '—';
  if (ops < 1000) return `≈${Math.round(ops)}`;
  let exp = Math.floor(Math.log10(ops));
  let mantissa = Math.round(ops / 10 ** exp);
  if (mantissa >= 10) {
    mantissa = 1;
    exp += 1;
  }
  return mantissa === 1 ? `≈10${superscript(exp)}` : `≈${mantissa}·10${superscript(exp)}`;
}

/** «10000» → «10 000» для подписи n. */
export function formatInt(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Подпись единиц оценки: «операций при n = 10 000». */
export function opsUnit(n: number): string {
  return `операций при n = ${formatInt(n)}`;
}

/** Подпись под любой оценкой «≈ операций» (ТЗ §8.4, frontend/CLAUDE.md). */
export const ESTIMATE_NOTE = 'асимптотическая оценка, не замер';

/** «≈10⁸ → ≈10⁴ операций при n = 10 000» из готовых opsBefore/opsAfter и Analysis.n. */
export function formatOpsEstimate(opsBefore: number, opsAfter: number, n: number): string {
  return `${formatOps(opsBefore)} → ${formatOps(opsAfter)} ${opsUnit(n)}`;
}

/** Разбор поля n: целое ≥ 1, пробелы-разделители допускаются; иначе null. */
export function parseN(text: string): number | null {
  const clean = text.replace(/[\s_]/g, '');
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** Имя файла без пути: «src/com/demo/OrderService.java» → «OrderService.java». */
export function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** «OrderService.merge:44» (или «OrderService.java:44», если methodId нет). */
export function issueLocation(issue: Issue): string {
  const where = issue.methodId ? shortMethodName(issue.methodId) : fileName(issue.span.file);
  return `${where}:${issue.span.startLine}`;
}

/**
 * Русские названия правил PMD 7 (Issue.rule = имя правила PMD) из категорий bestpractices, errorprone,
 * performance, multithreading — набор contract/fixtures/pmd-config.default.json, без исключённых там правил.
 */
const PMD_RULE_TITLES: Record<string, string> = {
  // bestpractices
  AbstractClassWithoutAbstractMethod: 'Абстрактный класс без абстрактных методов',
  AccessorClassGeneration: 'Закрытый конструктор вызывается из другого класса',
  AccessorMethodGeneration: 'Доступ к закрытому члену вложенного класса',
  ArrayIsStoredDirectly: 'Массив сохраняется без копирования',
  AssertStatementInTest: 'assert вместо проверок теста',
  AvoidMessageDigestField: 'MessageDigest в поле класса',
  AvoidPrintStackTrace: 'Вызов printStackTrace',
  AvoidReassigningCatchVariables: 'Переприсвоение переменной catch',
  AvoidReassigningLoopVariables: 'Переприсвоение переменной цикла',
  AvoidReassigningParameters: 'Переприсвоение параметра метода',
  AvoidStringBufferField: 'StringBuffer в поле класса',
  AvoidUsingHardCodedIP: 'IP-адрес в коде',
  CheckResultSet: 'Не проверен результат ResultSet',
  ConstantsInInterface: 'Константы в интерфейсе',
  DefaultLabelNotLastInSwitch: 'default не последний в switch',
  DoubleBraceInitialization: 'Инициализация двойными скобками',
  EnumComparison: 'Сравнение enum через equals',
  ExhaustiveSwitchHasDefault: 'Лишний default в полном switch',
  ForLoopCanBeForeach: 'for можно заменить на foreach',
  ForLoopVariableCount: 'Много переменных в заголовке for',
  GuardLogStatement: 'Лог без проверки уровня',
  ImplicitFunctionalInterface: 'Неявный функциональный интерфейс',
  JUnit4SuitesShouldUseSuiteAnnotation: 'JUnit 4: набор тестов без @Suite',
  JUnit5TestShouldBePackagePrivate: 'JUnit 5: тест должен быть package-private',
  JUnitJupiterTestShouldBePackagePrivate: 'JUnit 5: тест должен быть package-private',
  JUnitAssertionsShouldIncludeMessage: 'Проверка теста без сообщения',
  JUnitTestContainsTooManyAsserts: 'Слишком много проверок в тесте',
  JUnitTestsShouldIncludeAssert: 'Тест без проверок',
  JUnitUseExpected: 'Ожидаемое исключение через try/catch в тесте',
  LabeledStatement: 'Оператор с меткой',
  LiteralsFirstInComparisons: 'Литерал должен стоять первым в сравнении',
  LooseCoupling: 'Конкретный тип вместо интерфейса',
  MethodReturnsInternalArray: 'Метод возвращает внутренний массив',
  MissingOverride: 'Нет @Override',
  NonExhaustiveSwitch: 'switch без default',
  OnDemandImport: 'Импорт со звёздочкой',
  OneDeclarationPerLine: 'Несколько объявлений в одной строке',
  PreserveStackTrace: 'Потеряна причина исключения',
  PrimitiveWrapperInstantiation: 'Создание обёртки через new',
  RelianceOnDefaultCharset: 'Кодировка по умолчанию',
  ReplaceEnumerationWithIterator: 'Enumeration вместо Iterator',
  ReplaceHashtableWithMap: 'Hashtable вместо Map',
  ReplaceVectorWithList: 'Vector вместо List',
  SimplifiableTestAssertion: 'Проверку теста можно упростить',
  TypeNameMismatch: 'Имя типа не совпадает с именем файла',
  UnitTestAssertionsShouldIncludeMessage: 'Проверка теста без сообщения',
  UnitTestContainsTooManyAsserts: 'Слишком много проверок в тесте',
  UnitTestShouldIncludeAssert: 'Тест без проверок',
  UnitTestShouldUseAfterAnnotation: 'Тест: метод очистки без @After',
  UnitTestShouldUseBeforeAnnotation: 'Тест: метод подготовки без @Before',
  UnitTestShouldUseTestAnnotation: 'Тестовый метод без @Test',
  UnnecessaryVarargsArrayCreation: 'Лишнее создание массива для varargs',
  UnnecessaryWarningSuppression: 'Лишнее подавление предупреждения',
  UseCollectionIsEmpty: 'isEmpty() вместо size() == 0',
  UseEnumCollections: 'EnumSet/EnumMap вместо обычных коллекций',
  UseStandardCharsets: 'StandardCharsets вместо имени кодировки',
  UseTryWithResources: 'try-with-resources вместо finally',
  UseVarargs: 'Параметр-массив можно заменить на varargs',
  WhileLoopWithLiteralBoolean: 'while с литералом true/false',
  // errorprone
  AssertEqualsArgumentOrder: 'Неверный порядок аргументов assertEquals',
  AssignmentInOperand: 'Присваивание внутри выражения',
  AssignmentToNonFinalStatic: 'Присваивание нефинальному static-полю в конструкторе',
  AvoidAccessibilityAlteration: 'Обход модификаторов доступа через setAccessible',
  AvoidAssertAsIdentifier: 'assert как имя',
  AvoidBranchingStatementAsLastInLoop: 'break/continue/return в конце цикла',
  AvoidCallingFinalize: 'Явный вызов finalize',
  AvoidCatchingGenericException: 'Перехват слишком общего исключения',
  AvoidCatchingNPE: 'Перехват NullPointerException',
  AvoidCatchingThrowable: 'Перехват Throwable',
  AvoidDecimalLiteralsInBigDecimalConstructor: 'double-литерал в конструкторе BigDecimal',
  AvoidDuplicateLiterals: 'Повторяющиеся строковые литералы',
  AvoidEnumAsIdentifier: 'enum как имя',
  AvoidFieldNameMatchingMethodName: 'Имя поля совпадает с именем метода',
  AvoidFieldNameMatchingTypeName: 'Имя поля совпадает с именем класса',
  AvoidInstanceofChecksInCatchClause: 'instanceof в catch',
  AvoidLosingExceptionInformation: 'Потеря информации об исключении',
  AvoidMultipleUnaryOperators: 'Несколько унарных операторов подряд',
  AvoidUsingOctalValues: 'Восьмеричные литералы',
  BrokenNullCheck: 'Некорректная проверка на null',
  CallSuperFirst: 'super должен вызываться первым',
  CallSuperLast: 'super должен вызываться последним',
  CheckSkipResult: 'Не проверен результат skip()',
  ClassCastExceptionWithToArray: 'toArray приведёт к ClassCastException',
  CloneMethodMustBePublic: 'clone() должен быть public',
  CloneMethodMustImplementCloneable: 'clone() без реализации Cloneable',
  CloneMethodReturnTypeMustMatchClassName: 'Тип результата clone() не совпадает с классом',
  CloseResource: 'Ресурс не закрывается',
  CollectionTypeMismatch: 'Тип элемента не совпадает с типом коллекции',
  CompareObjectsWithEquals: 'Сравнение объектов через ==',
  ComparisonWithNaN: 'Сравнение с NaN',
  ConfusingArgumentToVarargsMethod: 'Неоднозначный аргумент varargs-метода',
  ConstructorCallsOverridableMethod: 'Конструктор вызывает переопределяемый метод',
  DetachedTestCase: 'Тест не помечен аннотацией',
  DoNotCallGarbageCollectionExplicitly: 'Явный вызов сборщика мусора',
  DoNotExtendJavaLangThrowable: 'Наследование от Throwable',
  DoNotHardCodeSDCard: 'Путь к SD-карте в коде',
  DoNotTerminateVM: 'Завершение JVM из кода',
  DoNotThrowExceptionInFinally: 'Исключение в блоке finally',
  DontImportSun: 'Импорт внутренних классов sun.*',
  DontUseFloatTypeForLoopIndices: 'Счётчик цикла типа float/double',
  EmptyFinalizer: 'Пустой finalize',
  EqualsNull: 'equals(null)',
  FinalizeDoesNotCallSuperFinalize: 'finalize не вызывает super.finalize',
  FinalizeOnlyCallsSuperFinalize: 'finalize только вызывает super.finalize',
  FinalizeOverloaded: 'Перегрузка finalize',
  FinalizeShouldBeProtected: 'finalize должен быть protected',
  IdempotentOperations: 'Бессмысленное присваивание самому себе',
  IdenticalConditionalBranches: 'Одинаковые ветки условия',
  ImplicitSwitchFallThrough: 'Проваливание в switch без break',
  InstantiationToGetClass: 'Создание объекта ради getClass()',
  InvalidLogMessageFormat: 'Неверный формат сообщения лога',
  JumbledIncrementer: 'Перепутан счётчик во вложенном цикле',
  JUnitJupiterTestNoPrivateModifier: 'JUnit 5: тест не должен быть private',
  JUnitSpelling: 'Опечатка в имени метода JUnit',
  JUnitStaticSuite: 'JUnit: suite() не static',
  LongLiteralEndingWithLowercaseL: 'long-литерал с маленькой l',
  MethodWithSameNameAsEnclosingClass: 'Метод с именем класса',
  MisplacedNullCheck: 'Проверка на null после использования',
  MissingSerialVersionUID: 'Нет serialVersionUID',
  MissingStaticMethodInNonInstantiatableClass: 'Класс без доступа к экземплярам и без static-методов',
  MoreThanOneLogger: 'Несколько логгеров в классе',
  NonCaseLabelInSwitch: 'Метка не case внутри switch',
  NonSerializableClass: 'Сериализуемый класс с несериализуемым полем',
  NonStaticInitializer: 'Нестатический блок инициализации',
  NullAssignment: 'Присваивание null',
  OverrideBothEqualsAndHashcode: 'Переопределён только equals или только hashCode',
  OverrideBothEqualsAndHashCodeOnComparable: 'Comparable: нет согласованных equals и hashCode',
  ProperCloneImplementation: 'Неверная реализация clone',
  ProperLogger: 'Неверное объявление логгера',
  ReplaceJavaUtilCalendar: 'java.util.Calendar вместо java.time',
  ReplaceJavaUtilDate: 'java.util.Date вместо java.time',
  ReturnEmptyCollectionRatherThanNull: 'Вместо null лучше вернуть пустую коллекцию',
  ReturnFromFinallyBlock: 'return в блоке finally',
  SimpleDateFormatNeedsLocale: 'SimpleDateFormat без Locale',
  SingleMethodSingleton: 'Синглтон с несколькими getInstance',
  SingletonClassReturningNewInstance: 'getInstance создаёт новый объект',
  StaticEJBFieldShouldBeFinal: 'Статическое поле EJB должно быть final',
  StringBufferInstantiationWithChar: 'StringBuffer(char) задаёт размер, а не символ',
  SuspiciousEqualsMethodName: 'Подозрительное имя метода equals',
  SuspiciousHashcodeMethodName: 'Подозрительное имя метода hashCode',
  SuspiciousOctalEscape: 'Подозрительная восьмеричная escape-последовательность',
  TestClassWithoutTestCases: 'Тестовый класс без тестов',
  UnconditionalIfStatement: 'if с константным условием',
  UnnecessaryBooleanAssertion: 'Бессмысленная проверка true/false',
  UnnecessaryCaseChange: 'Лишнее изменение регистра',
  UnnecessaryConversionTemporary: 'Лишний временный объект при преобразовании',
  UnsupportedJdkApiUsage: 'Использование неподдерживаемого API JDK',
  UnusedNullCheckInEquals: 'Лишняя проверка на null в equals',
  UnusedReturnValue: 'Результат метода никогда не используется',
  UseCorrectExceptionLogging: 'Исключение в логе передано неверно',
  UseEqualsToCompareStrings: 'Строки сравниваются через ==',
  UselessOperationOnImmutable: 'Бесполезная операция над неизменяемым объектом',
  UselessPureMethodCall: 'Бесполезный вызов чистого метода',
  UseLocaleWithCaseConversions: 'Смена регистра без Locale',
  UseProperClassLoader: 'Неверный ClassLoader',
  WrongTestAnnotation: 'Неверная аннотация теста',
  // performance
  AddEmptyString: 'Преобразование в строку через + ""',
  AppendCharacterWithChar: 'append("c") вместо append(\'c\')',
  AvoidArrayLoops: 'Копирование массива циклом',
  AvoidCalendarDateCreation: 'Создание даты через Calendar',
  AvoidFileStream: 'FileInputStream/FileOutputStream',
  BigIntegerInstantiation: 'Создание BigInteger/BigDecimal вместо констант',
  ConsecutiveAppendsShouldReuse: 'Подряд идущие append без цепочки',
  ConsecutiveLiteralAppends: 'Подряд идущие append литералов',
  InefficientEmptyStringCheck: 'Неэффективная проверка пустой строки',
  InefficientStringBuffering: 'Неэффективное построение строки в append',
  InsufficientStringBufferDeclaration: 'Мала начальная ёмкость StringBuilder',
  OptimizableToArrayCall: 'toArray можно оптимизировать',
  RedundantFieldInitializer: 'Лишняя инициализация поля значением по умолчанию',
  StringInstantiation: 'Создание строки через new String',
  StringToString: 'toString() у строки',
  TooFewBranchesForSwitch: 'Слишком мало ветвей в switch',
  UseArrayListInsteadOfVector: 'ArrayList вместо Vector',
  UseArraysAsList: 'Arrays.asList вместо ручного заполнения',
  UseIndexOfChar: 'indexOf(char) вместо indexOf(String)',
  UseIOStreamsWithApacheCommonsFileItem: 'Потоки Apache Commons вместо файлов',
  UselessStringValueOf: 'Лишний String.valueOf',
  UseStringBufferLength: 'length() вместо toString().length()',
  // multithreading
  AvoidSynchronizedAtMethodLevel: 'synchronized на уровне метода',
  AvoidSynchronizedStatement: 'Блок synchronized',
  AvoidThreadGroup: 'Использование ThreadGroup',
  AvoidUsingVolatile: 'Использование volatile',
  DoNotUseThreads: 'Прямое использование потоков',
  DontCallThreadRun: 'Вызов Thread.run вместо start',
  DoubleCheckedLocking: 'Двойная проверка блокировки',
  NonThreadSafeSingleton: 'Небезопасный для потоков синглтон',
  OverridingThreadRun: 'Переопределён Thread.run',
  UnsynchronizedStaticFormatter: 'Несинхронизированный static-форматтер',
  UseConcurrentHashMap: 'ConcurrentHashMap вместо HashMap',
  UseNotifyAllInsteadOfNotify: 'notifyAll вместо notify',
};

const RULE_TITLES: Record<string, string> = {
  DeadCode: 'Мёртвый код',
  DeepNesting: 'Глубокая вложенность',
  ExpensiveCallInLoop: 'Дорогой вызов в цикле',
  LinearSearchInLoop: 'Линейный поиск в цикле',
  LongMethod: 'Слишком длинный метод',
  NestedLoopSameCollection: 'Вложенный цикл по одной коллекции',
  StringConcatInLoop: 'Конкатенация строк в цикле',
  CyclicDependency: 'Циклическая зависимость классов',
  EmptyCatch: 'Пустой catch',
  CatchBug: 'Ошибочный catch',
  IgnoredResult: 'Результат вызова игнорируется',
  LongLine: 'Слишком длинная строка',
  ReferenceEquality: 'Сравнение ссылок вместо equals',
  ...PMD_RULE_TITLES,
};

/** Понятное название правила по id; неизвестный id (PMD и др.) — как есть. */
export function ruleTitle(rule: string): string {
  return RULE_TITLES[rule] ?? rule;
}

/**
 * Подсказка к «!» на ноде: по каждой проблеме «Название правила · серьёзность» и текст (message).
 * Нет проблемы с таким id в текущем анализе — только название правила из id («Правило:метод~0:24:35»).
 */
export function issueTooltip(ids: readonly string[], issues: readonly Issue[] = []): string {
  return ids
    .map((id) => {
      const issue = issues.find((i) => i.id === id);
      if (!issue) return ruleTitle(id.split(':')[0] ?? id);
      return `${ruleTitle(issue.rule)} · ${SEVERITY_LABEL[issue.severity]}\n${issue.message}`;
    })
    .join('\n\n');
}

/** Русское склонение: plural(12, 'проблема', 'проблемы', 'проблем') → «проблем». */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Строка-пояснение над списком вкладки: счётчик и чем вкладка отличается от соседней. */
export function issuesSummary(pick: 'problems' | 'warnings', issues: readonly Issue[]): string {
  if (pick === 'warnings') {
    return `${issues.length} ${plural(issues.length, 'предупреждение', 'предупреждения', 'предупреждений')} · низкая уверенность, без автоисправления`;
  }
  const fixable = issues.filter((i) => i.fixes.length > 0).length;
  return `${issues.length} ${plural(issues.length, 'проблема', 'проблемы', 'проблем')} · можно исправить автоматически: ${fixable}`;
}

export type ScopeKey = 'method' | 'class' | 'rest';

export interface ScopeGroup<T> {
  key: ScopeKey;
  label: string;
  items: T[];
}

const SCOPE_LABEL: Record<ScopeKey, string> = { method: 'Этот метод', class: 'Этот класс', rest: 'Остальное' };

/** Класс метода из MethodNode.id: «com.demo.OrderService.merge~0» → «com.demo.OrderService». */
function classOf(methodId: string): string {
  return methodId.replace(/~\d+$/, '').split('.').slice(0, -1).join('.');
}

/**
 * Группы «Этот метод» → «Этот класс» → «Остальное»; порядок внутри групп прежний (стабильно).
 * Пустые группы опущены. Без текущего метода всё в `rest` (порядок не меняется).
 */
export function groupByScope<T>(
  items: readonly T[],
  methodIdOf: (item: T) => string | undefined,
  currentMethodId: string | null,
): ScopeGroup<T>[] {
  const buckets: Record<ScopeKey, T[]> = { method: [], class: [], rest: [] };
  const cls = currentMethodId ? classOf(currentMethodId) : null;
  for (const item of items) {
    const id = methodIdOf(item);
    let key: ScopeKey = 'rest';
    if (currentMethodId !== null && id !== undefined) {
      if (id === currentMethodId) key = 'method';
      else if (classOf(id) === cls) key = 'class';
    }
    buckets[key].push(item);
  }
  return (['method', 'class', 'rest'] as const)
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, label: SCOPE_LABEL[key], items: buckets[key] }));
}
