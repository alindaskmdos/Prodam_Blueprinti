package blueprints.analysis;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Русские message и recommendation находок PMD по имени правила (BE-57). Аргументы {n} достаются из английского
 * сообщения сопоставлением с шаблоном правила ({@code Rule.getMessage()}); фрагмент русского текста в [ ] с {n} выпадает,
 * если аргумента нет. Сообщение не по шаблону (правило собрало его само) — {0} = первое имя в кавычках ('x' или `x`).
 * Неизвестное правило — английский текст как есть.
 */
final class PmdMessagesRu {
    record Text(String message, String recommendation) {}

    private static final Pattern TOKEN = Pattern.compile("\\{(\\d+)}|\\$\\{[^}]*}");
    private static final Pattern OPTIONAL = Pattern.compile("\\[([^\\]]*)]");
    private static final Pattern ARG = Pattern.compile("\\{(\\d+)}");
    private static final Pattern QUOTED = Pattern.compile("'([^']+)'|`([^`]+)`");
    private static final Map<String, Text> RU = new LinkedHashMap<>();

    private PmdMessagesRu() {}

    /**
     * Перевод находки правила {@code rule}: {@code template} — шаблон сообщения правила, {@code english} — готовое сообщение.
     * Неизвестное правило — {@code english} и {@code fallbackRecommendation}; иначе к русской рекомендации дописывается fallback.
     */
    static Text translate(String rule, String template, String english, String fallbackRecommendation) {
        Text t = RU.get(rule);
        if (t == null) return new Text(english, fallbackRecommendation);
        return new Text(fill(t.message(), args(template, english)), t.recommendation() + " " + fallbackRecommendation);
    }

    static boolean knows(String rule) {
        return RU.containsKey(rule);
    }

    /** {n} → значение из {@code text} по шаблону MessageFormat; не совпало — пусто. */
    static Map<Integer, String> args(String template, String text) {
        Map<Integer, String> out = new LinkedHashMap<>();
        if (template == null || text == null) return out;
        // шаблон может прийти из пользовательского ruleset: без регэкспа по шаблону, только indexOf — линейно по токенам
        List<String> literals = new ArrayList<>(); // literals.get(i) — перед i-м токеном; последний — хвост
        List<Integer> tokens = new ArrayList<>(); // номер {n}; -1 — ${свойство}, его PMD подставляет сам
        Matcher m = TOKEN.matcher(template);
        int at = 0;
        while (m.find()) {
            literals.add(norm(template.substring(at, m.start()).replace("''", "'")));
            tokens.add(m.group(1) != null ? Integer.parseInt(m.group(1)) : -1);
            at = m.end();
        }
        literals.add(norm(template.substring(at).replace("''", "'")));
        String t = norm(text).strip();
        Map<Integer, String> found = new LinkedHashMap<>();
        boolean ok = t.startsWith(literals.get(0).stripLeading());
        int pos = ok ? literals.get(0).stripLeading().length() : 0;
        for (int i = 0; ok && i < tokens.size(); i++) {
            String next = literals.get(i + 1);
            boolean last = i + 1 == tokens.size();
            String lit = last ? next.stripTrailing() : next;
            int end = last ? (t.endsWith(lit) && t.length() - lit.length() >= pos ? t.length() - lit.length() : -1) : t.indexOf(lit, pos);
            ok = end >= 0;
            if (ok && tokens.get(i) >= 0) found.putIfAbsent(tokens.get(i), t.substring(pos, end).strip());
            pos = end + lit.length();
        }
        if (ok && tokens.isEmpty()) ok = t.equals(literals.get(0).strip());
        if (ok) return found;
        // правило собрало сообщение само, не по шаблону: {0} — первое имя в кавычках, если есть
        Matcher q = QUOTED.matcher(text);
        if (q.find()) out.put(0, q.group(1) != null ? q.group(1) : q.group(2));
        return out;
    }

    /** Апострофы MessageFormat может съесть или оставить — убираем их; пробелы схлопываем. */
    private static String norm(String s) {
        return s.replace("'", "").replaceAll("\\s+", " ");
    }

    private static String fill(String s, Map<Integer, String> args) {
        Matcher o = OPTIONAL.matcher(s);
        StringBuilder b = new StringBuilder();
        while (o.find()) {
            Matcher a = ARG.matcher(o.group(1));
            boolean ok = true;
            while (a.find()) ok &= !args.getOrDefault(Integer.parseInt(a.group(1)), "").isEmpty();
            o.appendReplacement(b, Matcher.quoteReplacement(ok ? o.group(1) : ""));
        }
        o.appendTail(b);
        Matcher a = ARG.matcher(b.toString());
        StringBuilder r = new StringBuilder();
        while (a.find()) a.appendReplacement(r, Matcher.quoteReplacement(args.getOrDefault(Integer.parseInt(a.group(1)), "")));
        a.appendTail(r);
        return r.toString();
    }

    private static void r(String rule, String message, String recommendation) {
        RU.put(rule, new Text(message, recommendation));
    }

    static {
        // bestpractices
        r("AbstractClassWithoutAbstractMethod", "Абстрактный класс без абстрактных методов", "Добавьте абстрактный метод или сделайте класс обычным с закрытым конструктором.");
        r("AccessorClassGeneration", "Вызов закрытого конструктора извне класса порождает синтетический класс-посредник", "Сделайте конструктор видимым в пакете.");
        r("AccessorMethodGeneration", "Обращение к закрытому члену из вложенного класса порождает синтетический метод доступа", "Сделайте член видимым в пакете.");
        r("ArrayIsStoredDirectly", "Переданный массив[ «{0}»] сохраняется напрямую", "Сохраняйте копию массива (clone() или Arrays.copyOf).");
        r("AvoidMessageDigestField", "MessageDigest в поле не потокобезопасен", "Создавайте MessageDigest локально в методе.");
        r("AvoidPrintStackTrace", "Вызов printStackTrace()", "Логируйте исключение через логгер.");
        r("AvoidReassigningCatchVariables", "Переприсваивание пойманного исключения[ «{0}»]", "Заведите новую переменную вместо переприсваивания.");
        r("AvoidReassigningLoopVariables", "Переприсваивание переменной цикла[ «{0}»]", "Не меняйте переменную цикла в теле; заведите отдельную.");
        r("AvoidReassigningParameters", "Переприсваивание параметра[ «{0}»]", "Заведите локальную переменную вместо изменения параметра.");
        r("AvoidStringBufferField", "StringBuffer/StringBuilder в поле", "Держите StringBuilder локальной переменной: в поле он копит память.");
        r("CheckResultSet", "Результат ResultSet.next()/first()/… не проверяется", "Проверяйте возвращаемое значение навигации по ResultSet.");
        r("ConstantsInInterface", "Константы в интерфейсе", "Перенесите константы в класс или enum.");
        r("DefaultLabelNotLastInSwitch", "Метка default не последняя в switch", "Поставьте default последней веткой.");
        r("DefaultLabelNotLastInSwitchStmt", "Метка default не последняя в switch", "Поставьте default последней веткой.");
        r("DoubleBraceInitialization", "Инициализация двойными фигурными скобками", "Заполните коллекцию обычными вызовами или List.of/Map.of: двойные скобки создают анонимный класс.");
        r("EnumComparison", "Сравнение enum через equals()", "Сравнивайте значения enum через ==.");
        r("ExhaustiveSwitchHasDefault", "Исчерпывающий switch содержит лишнюю ветку default", "Уберите default: компилятор сам проверит полноту.");
        r("ForLoopCanBeForeach", "Цикл for можно заменить на for-each", "Перепишите цикл в форме for-each.");
        r("ForLoopVariableCount", "Слишком много переменных в заголовке for", "Оставьте в заголовке цикла одну переменную.");
        r("GuardLogStatement", "Вызов логгера без проверки уровня", "Оберните в if (log.isXxxEnabled()) или используйте параметризованные сообщения.");
        r("ImplicitFunctionalInterface", "Интерфейс с одним методом без @FunctionalInterface", "Добавьте @FunctionalInterface или второй метод, если интерфейс не функциональный.");
        r("JUnit4SuitesShouldUseSuiteAnnotation", "JUnit 4: набор тестов без аннотации @Suite", "Используйте @RunWith(Suite.class) и @SuiteClasses.");
        r("JUnit5TestShouldBePackagePrivate", "Тест JUnit 5 не должен быть public", "Уберите модификатор public у тестового класса и методов.");
        r("JUnitAssertionsShouldIncludeMessage", "Проверка в тесте без сообщения", "Добавьте сообщение в assert.");
        r("JUnitTestContainsTooManyAsserts", "Слишком много проверок в одном тесте", "Разбейте тест на несколько.");
        r("JUnitTestsShouldIncludeAssert", "Тест без проверок", "Добавьте assert в тест.");
        r("JUnitUseExpected", "Ожидаемое исключение ловится вручную", "Используйте assertThrows.");
        r("LiteralsFirstInComparisons", "Литерал в сравнении стоит вторым", "Пишите литерал первым: \"x\".equals(s) не бросит NullPointerException.");
        r("LooseCoupling", "Используется тип реализации[ «{0}»] вместо интерфейса", "Объявляйте переменные и параметры через интерфейс (List, Map, Set).");
        r("MethodReturnsInternalArray", "Возврат[ «{0}»] раскрывает внутренний массив", "Возвращайте копию массива.");
        r("MissingOverride", "Метод[ «{0}»] без аннотации @Override", "Добавьте @Override.");
        r("NonExhaustiveSwitch", "switch без ветки default", "Добавьте ветку default или обработайте все значения.");
        r("SwitchStmtsShouldHaveDefault", "switch без ветки default", "Добавьте ветку default.");
        r("OneDeclarationPerLine", "Несколько объявлений в одной строке", "Объявляйте по одной переменной на строку.");
        r("PreserveStackTrace", "Новое исключение теряет стек исходного[ «{0}»]", "Передайте исходное исключение как cause.");
        r("ReplaceEnumerationWithIterator", "Используется Enumeration", "Замените Enumeration на Iterator.");
        r("ReplaceHashtableWithMap", "Используется Hashtable", "Замените Hashtable на Map (HashMap/ConcurrentHashMap).");
        r("ReplaceVectorWithList", "Используется Vector", "Замените Vector на List (ArrayList).");
        r("SystemPrintln", "Вывод через System.out/System.err", "Используйте логгер.");
        r("UnitTestAssertionsShouldIncludeMessage", "Проверка в тесте без сообщения", "Добавьте сообщение в assert.");
        r("UnitTestContainsTooManyAsserts", "Слишком много проверок в одном тесте", "Разбейте тест на несколько.");
        r("UnitTestShouldIncludeAssert", "Тест без проверок", "Добавьте assert в тест.");
        r("UnitTestShouldUseAfterAnnotation", "Метод tearDown без аннотации @After/@AfterEach", "Добавьте аннотацию.");
        r("UnitTestShouldUseBeforeAnnotation", "Метод setUp без аннотации @Before/@BeforeEach", "Добавьте аннотацию.");
        r("UnitTestShouldUseTestAnnotation", "Тестовый метод без аннотации @Test", "Добавьте @Test.");
        r("JUnit4TestShouldUseAfterAnnotation", "Метод tearDown без аннотации @After", "Добавьте аннотацию.");
        r("JUnit4TestShouldUseBeforeAnnotation", "Метод setUp без аннотации @Before", "Добавьте аннотацию.");
        r("JUnit4TestShouldUseTestAnnotation", "Тестовый метод без аннотации @Test", "Добавьте @Test.");
        r("UnnecessaryVarargsArrayCreation", "Лишнее создание массива для varargs", "Передайте элементы напрямую.");
        r("UnusedAssignment", "Присвоенное значение не используется или перезаписывается", "Уберите лишнее присваивание.");
        r("UnusedFormalParameter", "Неиспользуемый параметр[ «{1}»]", "Удалите параметр или используйте его.");
        r("UnusedLocalVariable", "Неиспользуемая локальная переменная[ «{0}»]", "Удалите переменную.");
        r("UnusedPrivateField", "Неиспользуемое закрытое поле[ «{0}»]", "Удалите поле.");
        r("UnusedPrivateMethod", "Неиспользуемый закрытый метод[ «{0}»]", "Удалите метод.");
        r("UseCollectionIsEmpty", "Проверка пустоты через size()", "Используйте isEmpty().");
        r("UseStandardCharsets", "Кодировка задана строкой", "Используйте константы StandardCharsets.");
        r("UseTryWithResources", "Ресурс закрывается в finally вручную", "Используйте try-with-resources.");
        r("UseVarargs", "Массив последним параметром", "Объявите параметр как varargs.");
        r("WhileLoopWithLiteralBoolean", "Цикл while/do с литералом true/false в условии", "Перепишите цикл с осмысленным условием.");
        r("RelianceOnDefaultCharset", "Используется кодировка по умолчанию", "Явно укажите кодировку (StandardCharsets.UTF_8).");
        r("AvoidUsingFinalizeMethods", "Используется finalize()", "Освобождайте ресурсы явно (AutoCloseable).");

        // errorprone
        r("AssignmentInOperand", "Присваивание внутри выражения", "Вынесите присваивание в отдельный оператор.");
        r("AvoidAccessibilityAlteration", "Изменение доступности через рефлексию (setAccessible)", "Не обходите модификаторы доступа.");
        r("AvoidAssertAsIdentifier", "assert используется как имя", "Переименуйте: assert — ключевое слово.");
        r("AvoidBranchingStatementAsLastInLoop", "break/continue/return последним оператором цикла", "Перестройте цикл: последний оператор-переход сбивает с толку.");
        r("AvoidCallingFinalize", "Явный вызов finalize()", "Не вызывайте finalize() вручную.");
        r("AvoidCatchingNPE", "Перехват NullPointerException", "Проверяйте на null вместо перехвата NPE.");
        r("AvoidCatchingThrowable", "Перехват Throwable", "Ловите конкретные исключения.");
        r("AvoidDecimalLiteralsInBigDecimalConstructor", "BigDecimal из дробного литерала теряет точность", "Используйте new BigDecimal(\"0.1\") или BigDecimal.valueOf.");
        r("AvoidEnumAsIdentifier", "enum используется как имя", "Переименуйте: enum — ключевое слово.");
        r("AvoidFieldNameMatchingTypeName", "Имя поля совпадает с именем класса", "Переименуйте поле.");
        r("AvoidInstanceofChecksInCatchClause", "instanceof по исключению внутри catch", "Ловите каждый тип отдельным catch.");
        r("AvoidLosingExceptionInformation", "Результат метода исключения не используется", "Уберите вызов или используйте результат.");
        r("AvoidMultipleUnaryOperators", "Несколько унарных операторов подряд", "Упростите выражение.");
        r("AvoidUsingOctalValues", "Восьмеричный литерал (с ведущим нулём)", "Уберите ведущий ноль или явно используйте нужную систему счисления.");
        r("BrokenNullCheck", "Проверка на null не защищает от NullPointerException", "Исправьте условие (&& вместо || или наоборот).");
        r("CallSuperFirst", "super не вызывается первым", "Вызовите метод суперкласса в начале.");
        r("CallSuperLast", "super не вызывается последним", "Вызовите метод суперкласса в конце.");
        r("CheckSkipResult", "Результат InputStream.skip() не проверяется", "Проверяйте, сколько байт пропущено.");
        r("ClassCastExceptionWithToArray", "Приведение результата toArray() без аргумента", "Используйте toArray(new T[0]).");
        r("CloneMethodMustBePublic", "Метод clone() не public", "Сделайте clone() публичным.");
        r("CloneMethodMustImplementCloneable", "clone() в классе без Cloneable", "Реализуйте Cloneable или уберите clone().");
        r("CloneMethodReturnTypeMustMatchClassName", "clone() возвращает не тип своего класса", "Сделайте тип результата clone() равным классу.");
        r("CompareObjectsWithEquals", "Объекты сравниваются через ==", "Используйте equals().");
        r("ComparisonWithNaN", "Сравнение с NaN через ==", "Используйте Double.isNaN().");
        r("ConfusingArgumentToVarargsMethod", "Неоднозначный аргумент varargs-метода", "Явно приведите аргумент к массиву или элементу.");
        r("ConstructorCallsOverridableMethod", "Конструктор вызывает переопределяемый метод", "Сделайте метод private/final или не вызывайте его из конструктора.");
        r("DetachedTestCase", "Тестовый метод без аннотации @Test", "Добавьте @Test.");
        r("DoNotCallGarbageCollectionExplicitly", "Явный вызов сборщика мусора", "Уберите System.gc().");
        r("DoNotExtendJavaLangThrowable", "Наследование от Throwable", "Наследуйте от Exception или RuntimeException.");
        r("DoNotHardCodeSDCard", "Путь /sdcard зашит в код", "Используйте Environment.getExternalStorageDirectory().");
        r("DoNotTerminateVM", "Завершение JVM из кода (System.exit)", "Бросайте исключение или возвращайте код наверх.");
        r("DoNotThrowExceptionInFinally", "Исключение бросается в finally", "Не бросайте исключения из finally: они скрывают исходное.");
        r("DontImportSun", "Импорт из sun.*", "Не используйте внутренние классы JDK.");
        r("DontUseFloatTypeForLoopIndices", "Индекс цикла типа float", "Используйте целочисленный счётчик.");
        r("EmptyCatchBlock", "Пустой блок catch", "Обработайте или залогируйте исключение.");
        r("EmptyFinalizer", "Пустой finalize()", "Удалите метод.");
        r("EqualsNull", "Сравнение через equals(null)", "Используйте == null.");
        r("FinalizeDoesNotCallSuperFinalize", "finalize() не вызывает super.finalize()", "Вызовите super.finalize() последним.");
        r("FinalizeOnlyCallsSuperFinalize", "finalize() только вызывает super.finalize()", "Удалите метод.");
        r("FinalizeOverloaded", "Перегрузка finalize()", "Переименуйте метод.");
        r("FinalizeShouldBeProtected", "finalize() не protected", "Сделайте finalize() protected.");
        r("IdempotentOperations", "Операция ничего не меняет (x = x)", "Удалите или исправьте присваивание.");
        r("ImplicitSwitchFallThrough", "Неявный проход в следующую ветку switch", "Добавьте break/return или комментарий о намеренном проходе.");
        r("InstantiationToGetClass", "Создание объекта ради getClass()", "Используйте литерал класса (X.class).");
        r("InvalidLogMessageFormat", "Число аргументов не совпадает с шаблоном сообщения лога", "Согласуйте {} в шаблоне и аргументы.");
        r("JumbledIncrementer", "Во вложенном цикле увеличивается переменная внешнего", "Проверьте переменные циклов.");
        r("JUnitSpelling", "Похоже на опечатку в имени setUp/tearDown", "Исправьте имя метода.");
        r("JUnitStaticSuite", "Метод suite() не public static", "Объявите suite() как public static.");
        r("MethodWithSameNameAsEnclosingClass", "Метод назван как класс", "Переименуйте метод — или это должен быть конструктор.");
        r("MissingSerialVersionUID", "Serializable-класс без serialVersionUID", "Объявите serialVersionUID.");
        r("MissingStaticMethodInNonInstantiatableClass", "Класс с закрытыми конструкторами без статических методов", "Добавьте статическую фабрику или откройте конструктор.");
        r("MoreThanOneLogger", "Больше одного логгера в классе", "Оставьте один логгер.");
        r("NonCaseLabelInSwitchStatement", "Метка, не являющаяся case, внутри switch", "Уберите метку.");
        r("NonCaseLabelInSwitch", "Метка, не являющаяся case, внутри switch", "Уберите метку.");
        r("NonSerializableClass", "Поле[ «{0}»] Serializable-класса не сериализуемо", "Сделайте поле transient или его тип Serializable.");
        r("NonStaticInitializer", "Нестатический блок инициализации", "Перенесите код в конструктор.");
        r("NullAssignment", "Присваивание null вне объявления", "Перестройте код без обнуления переменной.");
        r("OverrideBothEqualsAndHashcode", "Переопределён только один из equals()/hashCode()", "Переопределите оба метода.");
        r("OverrideBothEqualsAndHashCodeOnComparable", "Comparable-класс без equals()/hashCode()", "Переопределите equals() и hashCode() согласованно с compareTo().");
        r("ProperCloneImplementation", "clone() создаёт объект через new", "Вызывайте super.clone().");
        r("ProperLogger", "Логгер объявлен неправильно", "Объявите логгер private static final с классом-владельцем.");
        r("ReturnEmptyCollectionRatherThanNull", "Возвращается null вместо пустой коллекции/массива", "Возвращайте пустую коллекцию или массив.");
        r("ReturnFromFinallyBlock", "return в блоке finally", "Уберите return из finally: он глотает исключения.");
        r("SimpleDateFormatNeedsLocale", "SimpleDateFormat без Locale", "Передайте Locale явно.");
        r("SingleMethodSingleton", "Несколько getInstance() у синглтона", "Оставьте один метод получения экземпляра.");
        r("SingletonClassReturningNewInstance", "getInstance() синглтона создаёт новый объект", "Возвращайте один сохранённый экземпляр.");
        r("StaticEJBFieldShouldBeFinal", "Статическое поле EJB не final", "Объявите поле final.");
        r("StringBufferInstantiationWithChar", "StringBuilder/StringBuffer создан из char", "char трактуется как ёмкость: передайте строку.");
        r("SuspiciousEqualsMethodName", "Подозрительное имя или сигнатура equals", "Проверьте, что переопределён equals(Object).");
        r("SuspiciousHashcodeMethodName", "Подозрительное имя hashcode()", "Назовите метод hashCode().");
        r("SuspiciousOctalEscape", "Подозрительная восьмеричная escape-последовательность", "Проверьте экранирование в строке.");
        r("UnconditionalIfStatement", "Условие if всегда истинно или ложно", "Уберите лишний if.");
        r("UnnecessaryBooleanAssertion", "Проверка константы true/false в тесте", "Уберите бессмысленную проверку.");
        r("UnnecessaryCaseChange", "Лишняя смена регистра перед сравнением", "Используйте equalsIgnoreCase().");
        r("UnnecessaryConversionTemporary", "Лишний временный объект при преобразовании в строку", "Используйте статический toString() обёртки.");
        r("UnusedNullCheckInEquals", "После проверки на null вызов идёт не на том объекте", "Вызывайте equals на объекте, проверенном на null.");
        r("UseCorrectExceptionLogging", "Исключение логируется без стека", "Передайте исключение логгеру отдельным аргументом.");
        r("UseEqualsToCompareStrings", "Строки сравниваются через == или !=", "Используйте equals().");
        r("UselessOperationOnImmutable", "Результат операции над неизменяемым объектом отброшен", "Присвойте результат — объект не меняется на месте.");
        r("UseLocaleWithCaseConversions", "toLowerCase()/toUpperCase() без Locale", "Передайте Locale (например, Locale.ROOT).");
        r("UseProperClassLoader", "Используется getClass().getClassLoader() в J2EE", "Используйте Thread.currentThread().getContextClassLoader().");

        // performance
        r("AddEmptyString", "Преобразование в строку через сложение с \"\"", "Используйте String.valueOf().");
        r("AppendCharacterWithChar", "append() строки из одного символа", "Передавайте char: append('c').");
        r("AvoidArrayLoops", "Копирование массива в цикле", "Используйте System.arraycopy() или Arrays.copyOf().");
        r("AvoidCalendarDateCreation", "Получение текущей даты через Calendar", "Используйте System.currentTimeMillis() или java.time.");
        r("AvoidFileStream", "FileInputStream/FileOutputStream", "Используйте Files.newInputStream/newOutputStream.");
        r("AvoidInstantiatingObjectsInLoops", "Создание объектов в цикле", "Вынесите создание из цикла, если возможно.");
        r("BigIntegerInstantiation", "Создание BigInteger/BigDecimal для стандартной константы", "Используйте BigInteger.ZERO/ONE/TEN и т.п.");
        r("ConsecutiveAppendsShouldReuse", "Последовательные append() без цепочки", "Объедините вызовы в цепочку.");
        r("InefficientEmptyStringCheck", "Неэффективная проверка пустой строки через trim()", "Используйте isBlank().");
        r("InefficientStringBuffering", "Конкатенация внутри append()", "Передавайте части отдельными append().");
        r("OptimizableToArrayCall", "toArray() с массивом заданного размера", "Используйте toArray(new T[0]).");
        r("RedundantFieldInitializer", "Поле явно инициализировано значением по умолчанию", "Уберите лишнюю инициализацию.");
        r("StringInstantiation", "Создание String через new", "Используйте строку напрямую.");
        r("StringToString", "toString() у строки", "Уберите лишний вызов.");
        r("TooFewBranchesForSwitch", "В switch слишком мало веток", "Замените switch на if.");
        r("UseArrayListInsteadOfVector", "Используется Vector", "Используйте ArrayList.");
        r("UseArraysAsList", "Заполнение списка из массива в цикле", "Используйте Arrays.asList() или List.of().");
        r("UseIndexOfChar", "indexOf() строки из одного символа", "Передавайте char: indexOf('c').");
        r("UselessStringValueOf", "Лишний String.valueOf() при конкатенации", "Уберите вызов.");
        r("UseStringBufferForStringAppends", "Конкатенация строк через +=", "Используйте StringBuilder.");
        r("UseStringBufferLength", "Длина StringBuilder через toString().length()", "Используйте length() самого StringBuilder.");

        // multithreading
        r("AvoidSynchronizedAtMethodLevel", "synchronized на уровне метода", "Синхронизируйте только нужный блок.");
        r("AvoidSynchronizedStatement", "Блок synchronized (блокирует виртуальные потоки)", "Используйте ReentrantLock.");
        r("AvoidThreadGroup", "Используется ThreadGroup", "Не используйте ThreadGroup: она не потокобезопасна.");
        r("AvoidUsingVolatile", "Используется volatile", "Проверьте, нужен ли volatile; надёжнее — java.util.concurrent.");
        r("DoNotUseThreads", "Прямая работа с потоками", "Используйте ExecutorService или средства контейнера.");
        r("DontCallThreadRun", "Вызов Thread.run() вместо start()", "Вызывайте start(): run() выполняется в текущем потоке.");
        r("DoubleCheckedLocking", "Блокировка с двойной проверкой", "Используйте volatile, holder-класс или enum.");
        r("NonThreadSafeSingleton", "Синглтон с ленивой инициализацией не потокобезопасен", "Инициализируйте экземпляр статически или синхронизируйте.");
        r("UnsynchronizedStaticFormatter", "Статический форматтер используется без синхронизации", "Синхронизируйте доступ или используйте DateTimeFormatter.");
        r("UseConcurrentHashMap", "Map вместо ConcurrentHashMap", "Используйте ConcurrentHashMap при доступе из нескольких потоков.");
        r("UseNotifyAllInsteadOfNotify", "notify() вместо notifyAll()", "Используйте notifyAll().");

        // codestyle (quickstart и частые)
        r("ClassNamingConventions", "Имя типа[ «{1}»] не соответствует шаблону[ «{2}»]", "Переименуйте по соглашению (UpperCamelCase).");
        r("MethodNamingConventions", "Имя метода[ «{1}»] не соответствует шаблону[ «{2}»]", "Переименуйте по соглашению (lowerCamelCase).");
        r("FieldNamingConventions", "Имя поля[ «{1}»] не соответствует шаблону[ «{2}»]", "Переименуйте по соглашению.");
        r("FormalParameterNamingConventions", "Имя параметра[ «{1}»] не соответствует шаблону[ «{2}»]", "Переименуйте по соглашению (lowerCamelCase).");
        r("LocalVariableNamingConventions", "Имя локальной переменной[ «{1}»] не соответствует шаблону[ «{2}»]", "Переименуйте по соглашению (lowerCamelCase).");
        r("GenericsNaming", "Имя параметра типа не соответствует соглашению", "Используйте одну заглавную букву.");
        r("PackageCase", "Имя пакета содержит заглавные буквы", "Используйте строчные буквы.");
        r("NoPackage", "Класс вне пакета", "Объявите пакет.");
        r("AvoidDollarSigns", "Символ $ в имени", "Уберите $ из имени.");
        r("AvoidProtectedFieldInFinalClass", "protected-поле в final-классе", "Сделайте поле private или package-private.");
        r("AvoidProtectedMethodInFinalClassNotExtending", "protected-метод в final-классе", "Сделайте метод private или package-private.");
        r("AvoidUsingNativeCode", "Используется нативный код (JNI)", "Избегайте System.loadLibrary без необходимости.");
        r("ControlStatementBraces", "Оператор без фигурных скобок", "Добавьте фигурные скобки.");
        r("EmptyControlStatement", "Пустое тело оператора", "Удалите оператор или добавьте тело.");
        r("ExtendsObject", "Явное extends Object", "Уберите extends Object.");
        r("ForLoopShouldBeWhileLoop", "Цикл for можно заменить на while", "Перепишите в форме while.");
        r("LambdaCanBeMethodReference", "Лямбду можно заменить ссылкой на метод[ «{0}»]", "Используйте ссылку на метод.");
        r("UnnecessaryAnnotationValueElement", "Лишнее value= в аннотации", "Уберите value=.");
        r("UnnecessaryBoxing", "Лишняя упаковка/распаковка", "Уберите явное преобразование.");
        r("UnnecessaryConstructor", "Лишний конструктор", "Удалите конструктор: его создаст компилятор.");
        r("UnnecessaryFullyQualifiedName", "Лишнее уточнение имени[ «{0}»]", "Используйте короткое имя.");
        r("UnnecessaryImport", "Лишний import[ «{0}»]", "Удалите import.");
        r("UnnecessaryLocalBeforeReturn", "Лишняя локальная переменная[ «{0}»] перед return", "Возвращайте выражение сразу.");
        r("UnnecessaryModifier", "Лишний модификатор[ у «{2}»]", "Уберите модификатор.");
        r("UnnecessaryReturn", "Лишний return", "Удалите return.");
        r("UnnecessarySemicolon", "Лишняя точка с запятой", "Удалите её.");
        r("UselessParentheses", "Лишние скобки", "Уберите скобки.");
        r("UselessQualifiedThis", "Лишнее уточнение this", "Используйте просто this.");
        r("UseShortArrayInitializer", "Длинная форма инициализации массива", "Используйте краткую форму {…}.");
        r("UseExplicitTypes", "Тип выведен через var", "Укажите тип явно.");
        r("ConfusingTernary", "Тернарный оператор или if-else с отрицанием в условии", "Переставьте ветки и уберите отрицание.");
        r("LinguisticNaming", "Имя противоречит смыслу (например, getX ничего не возвращает)", "Переименуйте.");
        r("LocalVariableCouldBeFinal", "Локальная переменная[ «{0}»] может быть final", "Объявите final.");
        r("MethodArgumentCouldBeFinal", "Параметр[ «{0}»] может быть final", "Объявите final.");
        r("ShortMethodName", "Слишком короткое имя метода", "Дайте говорящее имя.");
        r("OnlyOneReturn", "Несколько return в методе", "Оставьте одну точку выхода.");
        r("AtLeastOneConstructor", "Класс без конструктора", "Объявите конструктор.");
        r("PrematureDeclaration", "Переменная[ «{0}»] объявлена раньше, чем нужна", "Перенесите объявление ближе к использованию.");
        r("EmptyMethodInAbstractClassShouldBeAbstract", "Пустой метод в абстрактном классе", "Сделайте метод абстрактным.");
        r("FieldDeclarationsShouldBeAtStartOfClass", "Поле объявлено не в начале класса", "Перенесите поля в начало класса.");
        r("BooleanGetMethodName", "Метод getX возвращает boolean", "Назовите метод isX или hasX.");
        r("CallSuperInConstructor", "Конструктор без явного super()", "Вызовите super() явно.");
        r("TooManyStaticImports", "Слишком много static import", "Сократите число статических импортов.");

        // design (quickstart и частые)
        r("AbstractClassWithoutAnyMethod", "Абстрактный класс без методов", "Сделайте класс обычным или интерфейсом.");
        r("ClassWithOnlyPrivateConstructorsShouldBeFinal", "Класс только с закрытыми конструкторами не final", "Объявите класс final.");
        r("DoNotExtendJavaLangError", "Наследование от Error", "Наследуйте от Exception или RuntimeException.");
        r("LogicInversion", "Отрицание всего условия", "Используйте противоположный оператор сравнения.");
        r("SimplifiedTernary", "Тернарный оператор с литералом true/false", "Замените на логическое выражение.");
        r("SimplifyBooleanExpressions", "Сравнение с литералом true/false", "Упростите логическое выражение.");
        r("SimplifyConditional", "Лишняя проверка на null перед instanceof", "Уберите проверку: instanceof false для null.");
        r("SingularField", "Поле[ «{0}»] можно заменить локальной переменной", "Перенесите поле в метод.");
        r("UselessOverridingMethod", "Переопределение только вызывает super", "Удалите метод.");
        r("UseUtilityClass", "Класс только со статическими методами", "Сделайте класс final с закрытым конструктором.");
        r("ImmutableField", "Поле[ «{0}»] можно объявить final", "Объявите поле final.");
        r("AvoidThrowingNullPointerException", "Явный throw NullPointerException", "Используйте Objects.requireNonNull или IllegalArgumentException.");
        r("AvoidRethrowingException", "catch только перебрасывает исключение", "Уберите лишний catch.");
        r("AvoidThrowingNewInstanceOfSameException", "catch бросает новое исключение того же типа", "Перебросьте исходное или оберните другим типом.");
        r("AvoidDeeplyNestedIfStmts", "Слишком глубокая вложенность if", "Используйте ранний return или вынесите код в методы.");
        r("CollapsibleIfStatements", "Вложенные if можно объединить", "Объедините условия через &&.");
        r("SignatureDeclareThrowsException", "Метод объявляет throws Exception", "Объявляйте конкретные исключения.");
        r("CognitiveComplexity", "Высокая когнитивная сложность[ «{1}»][: {2} при пороге {3}]", "Разбейте на более простые методы.");
        r("CyclomaticComplexity", "Высокая цикломатическая сложность[ «{1}»][: {3}]", "Разбейте на более простые методы.");
        r("NPathComplexity", "Высокая NPath-сложность[ «{1}»][: {2} при пороге {3}]", "Сократите число ветвлений.");
        r("LawOfDemeter", "Нарушение закона Деметры", "Обращайтесь только к непосредственным соседям объекта.");
        r("TooManyFields", "Слишком много полей", "Сгруппируйте поля в объекты.");
        r("TooManyMethods", "Слишком много методов", "Разделите класс.");
        r("ExceptionAsFlowControl", "Исключение используется для управления потоком", "Используйте условия вместо throw/catch.");
        r("MutableStaticState", "Изменяемое статическое состояние", "Сделайте поле final или уберите static.");
        r("SwitchDensity", "Слишком много операторов в ветках switch", "Вынесите ветки в методы.");
        r("UseObjectForClearerAPI", "Много строковых параметров в публичном методе", "Объедините параметры в объект.");

        // правила с аргументами в сообщении
        r("AvoidUsingHardCodedIP", "IP-адрес[ «{0}»] зашит в код", "Вынесите адрес в конфигурацию.");
        r("LabeledStatement", "Оператор с меткой[ «{0}»]", "Вынесите код в метод вместо break/continue по метке.");
        r("PrimitiveWrapperInstantiation", "Создание[ {0}] через new", "Используйте valueOf() или автоупаковку.");
        r("SimplifiableTestAssertion", "Проверку в тесте можно упростить[: {0}]", "Используйте более точный assert.");
        r("UseEnumCollections", "Коллекция с ключами-enum[: подойдёт {0}]", "Используйте EnumMap/EnumSet.");
        r("AvoidThrowingRawExceptionTypes", "Бросается общий тип исключения[ {0}]", "Бросайте конкретное исключение.");
        r("AvoidUncheckedExceptionsInSignatures", "Непроверяемое исключение[ {0}] в throws", "Уберите его из сигнатуры, опишите в javadoc.");
        r("NcssCount", "Слишком много операторов (NCSS)[ в «{1}»][: {2}]", "Разбейте на части.");
        r("CouplingBetweenObjects", "Высокая связанность с другими типами[: {0} при пороге {1}]", "Уменьшите число зависимостей.");
        r("DataClass", "Класс[ «{0}»] похож на класс только с данными", "Перенесите поведение к данным.");
        r("ExcessiveImports", "Слишком много импортов[: {0} при пороге {1}]", "Разделите класс по ответственности.");
        r("ExcessiveParameterList", "Слишком много параметров[: {0} при пороге {1}]", "Объедините параметры в объект.");
        r("ExcessivePublicCount", "Слишком много публичных членов[: {0} при пороге {1}]", "Сократите публичный интерфейс.");
        r("FinalFieldCouldBeStatic", "final-поле[ «{0}»] с константой может быть static", "Объявите поле static.");
        r("PublicMemberInNonPublicType", "Публичный член[ «{0}»] в непубличном типе", "Снизьте видимость члена.");
        r("SimplifyBooleanReturns", "Оператор if можно упростить[ до «{0}»]", "Верните логическое выражение напрямую.");
        r("AssignmentToNonFinalStatic", "Присваивание нефинальному статическому полю[ «{0}»] в конструкторе", "Инициализируйте статическое поле статически.");
        r("AvoidCatchingGenericException", "Перехват общего исключения[ {0}]", "Ловите конкретные исключения.");
        r("AvoidDuplicateLiterals", "Строковый литерал[ {0}] повторяется[ {1} раз(а), впервые — в строке {2}]", "Вынесите литерал в константу.");
        r("AvoidFieldNameMatchingMethodName", "Имя поля[ «{0}»] совпадает с именем метода", "Переименуйте поле или метод.");
        r("AvoidLiteralsInIfCondition", "Литерал[ {0}] в условии if", "Вынесите значение в именованную константу.");
        r("CloseResource", "Ресурс[ {0}] не закрывается", "Закройте ресурс, лучше через try-with-resources.");
        r("CollectionTypeMismatch", "Тип аргумента не совпадает с типом элементов коллекции[: «{0}» вместо «{1}»]", "Проверьте тип: такой элемент в коллекции не найдётся.");
        r("MisplacedNullCheck", "Проверка на null[ «{0}»] стоит после обращения к объекту", "Проверяйте на null до использования.");
        r("TestClassWithoutTestCases", "Класс[ «{0}»] похож на тестовый, но без тестов", "Добавьте тесты или переименуйте класс.");
        r("UselessPureMethodCall", "Результат вызова[ {0}] без побочных эффектов не используется", "Используйте результат или удалите вызов.");
        r("InsufficientStringBufferDeclaration", "Недостаточная начальная ёмкость[ {0}: {1}, а добавляется не меньше {2} символов]", "Задайте ёмкость с запасом.");
        r("ConsecutiveLiteralAppends", "Несколько append() литералов подряд[ ({0})]", "Объедините литералы в один append().");
        r("UnnecessaryCast", "Лишнее приведение типа[ ({0})]", "Уберите приведение.");
        r("UseDiamondOperator", "Явные аргументы типа можно заменить на <>[: {0}]", "Используйте оператор <>.");
        r("UseUnderscoresInNumericLiterals", "Длинный числовой литерал[ {0}] без _", "Разделите разряды подчёркиванием.");
        r("IdenticalCatchBranches", "Ветка catch совпадает с другой[ («{0}»)]", "Объедините в multi-catch (A | B e).");
        r("CommentDefaultAccessModifier", "Доступ по умолчанию без комментария[ у «{1}»]", "Добавьте комментарий /* default */ или модификатор.");
        r("GodClass", "«Божественный» класс[ (WMC={0}, ATFD={2}, TCC={1})]", "Разделите класс по ответственности.");
        r("ShortVariable", "Слишком короткое имя[ «{0}»]", "Дайте говорящее имя.");
        r("ShortClassName", "Слишком короткое имя класса[ «{0}»]", "Дайте говорящее имя.");
        r("LongVariable", "Слишком длинное имя[ «{0}»]", "Сократите имя.");
        r("UnusedReturnValue", "Результат[ «{0}»] не используется", "Используйте результат или удалите вызов.");
        r("UnusedLabel", "Неиспользуемая метка[ «{0}»]", "Удалите метку.");
        r("TypeNameMismatch", "Тип верхнего уровня[ {0}] объявлен в файле с другим именем", "Переименуйте файл или тип.");
        r("UnnecessaryWarningSuppression", "Лишнее подавление предупреждения[ {0}]", "Удалите ненужный @SuppressWarnings или NOPMD.");
        r("TypeParameterNamingConventions", "Имя параметра типа[ «{1}»] не соответствует шаблону[ «{2}»]", "Переименуйте по соглашению.");
        r("VariableCanBeInlined", "Переменную[ «{0}»] можно встроить", "Используйте значение напрямую.");
        r("VariableDeclarationUsageDistance", "Переменная[ «{0}»] объявлена далеко от использования[ ({1} при пороге {2})]", "Перенесите объявление ближе к использованию.");
        r("UnnecessaryInterfaceDeclaration", "Лишнее объявление интерфейса[ «{0}»]", "Уберите интерфейс: его уже даёт родитель.");
        r("WrongTestAnnotation", "Аннотация теста не из используемой версии JUnit[: {0}]", "Используйте аннотации своей версии JUnit.");

        // правила без аргументов, не вошедшие выше
        r("AssertStatementInTest", "assert в тестовом коде", "Используйте проверки тестового фреймворка.");
        r("JUnitJupiterTestShouldBePackagePrivate", "Тест JUnit 5 не должен быть public", "Уберите модификатор public у тестового класса и методов.");
        r("JUnitJupiterTestNoPrivateModifier", "Тест JUnit не может быть private", "Уберите private.");
        r("OnDemandImport", "Импорт со звёздочкой", "Импортируйте конкретные классы.");
        r("AssertEqualsArgumentOrder", "В assertEquals перепутаны ожидаемое и фактическое значения", "Ожидаемое значение — первым аргументом.");
        r("IdenticalConditionalBranches", "Ветки условия одинаковы — условие ни на что не влияет", "Уберите условие или исправьте ветки.");
        r("LongLiteralEndingWithLowercaseL", "long-литерал со строчной l", "Используйте заглавную L.");
        r("ReplaceJavaUtilCalendar", "Используется java.util.Calendar", "Используйте классы java.time.");
        r("ReplaceJavaUtilDate", "Используется java.util.Date", "Используйте классы java.time.");
        r("UnsupportedJdkApiUsage", "Используется неподдерживаемый API JDK", "Замените на публичный API.");
        r("UseIOStreamsWithApacheCommonsFileItem", "FileItem.get()/getString() загружает файл в память", "Используйте getInputStream().");
        r("OverridingThreadRun", "Переопределение Thread.run()", "Передавайте Runnable в Thread.");
        r("FinalParameterInAbstractMethod", "final у параметра абстрактного метода", "Уберите final.");
        r("InstantiableUtilityClass", "Класс только со статическими членами можно инстанцировать", "Добавьте закрытый конструктор без параметров.");
        r("ProtectedMemberInFinalClass", "protected-член в final-классе", "Сделайте член private или package-private.");
        r("DanglingJavadoc", "Javadoc-комментарий ни к чему не относится", "Перенесите комментарий к объявлению или сделайте обычным.");
        r("UncommentedEmptyConstructor", "Пустой конструктор без комментария", "Поясните комментарием, почему он пуст.");
        r("UncommentedEmptyMethodBody", "Пустое тело метода без комментария", "Поясните комментарием, почему оно пусто.");
        r("CStyleArrayDeclaration", "Объявление массива в стиле C", "Пишите скобки у типа: int[] a.");
        r("UnnecessaryBlock", "Лишний блок", "Уберите фигурные скобки.");
        r("ModifierOrder", "Неправильный порядок модификаторов", "Расставьте модификаторы в порядке JLS.");
        r("HardCodedCryptoKey", "Ключ шифрования зашит в код", "Храните ключ вне кода.");
        r("InsecureCryptoIv", "Вектор инициализации зашит в код", "Генерируйте IV случайно.");
    }
}
