# samples/roundtrip

Корпус round-trip (§5): по маленькому файлу на конструкцию. Каждый файл — класс в пакете по умолчанию, чистая JDK 21, свой `main`,
детерминированный и не зависящий от локали stdout (LF). Используют `RoundTripCorpusTest` (файл → блоки → Java → тот же вывод)
и инструментация (§14а.6). Ожидания: `expected/X.out`, ненулевой код выхода — `expected/X.exit`, stdin — `X.in`.

| Файлы | Конструкции | Ожидаемые kind |
|---|---|---|
| Variables, Strings, Lambdas | var, составные операторы, ++/--, тернарный, касты, final; text block, escape, unicode, StringBuilder; лямбды, ссылки на методы, стримы | var, assign, expr |
| IfElse, Returns, Recursion | if/else if/else, вложенные, без скобок, пустой оператор; ранний return, из void и из цикла; рекурсия | if, return, raw (`;`) |
| WhileLoops, ForLoops, BreakContinue | while, do-while; for (несколько init/update, пустые части), for-each; break/continue с меткой, labeled-блок | while, dowhile, for, foreach, break, continue, raw (labeled) |
| SwitchStatements, ScannerInput (+ .in) | switch с fallthrough по int/String/enum, со стрелками, switch-выражение с yield; чтение stdin через Scanner | switch, case, return; yield — raw/текст |
| TryCatch, SystemExit, UncaughtException | try/catch/finally, multi-catch, try-with-resources, своё исключение, throw; `System.exit(3)`; необработанное исключение (exit 1, stderr не сравнивается) | try, catch, throw |
| Comments | строчные, блочные, в конце строки, javadoc; комментарий внутри выражения теряется | comment |
| NestedClasses, GenericsArrays, TypesOop, CollectionsDemo | вложенные/inner/анонимные/локальные типы; generics, wildcard, массивы, varargs; record, enum с телом, default/static, abstract, this()/super(), инициализаторы; коллекции, Iterator.remove, Comparator | method, var, expr, raw (локальные типы) |
| RareConstructs | synchronized, assert, pattern instanceof, record/pattern switch, sealed, `this.<T>m()` | raw, if, return |

Запуск: `bash samples/roundtrip/run-tests.sh` (PASS/FAIL по файлу, exit 1 при любом FAIL); `--regen` перезаписывает `expected/`.
