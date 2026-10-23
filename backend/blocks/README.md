# blocks

`AstToBlocks`, `BlocksToJava`, валидация текста нод (§5 ТЗ). Неподдержанная конструкция — блок `raw`.

`AstToBlocks.convert(CallableDeclaration<?> decl, String methodId, String file)` -> `Block` kind=method,
`signature` — точный исходный текст заголовка до тела; id — `<methodId>/<slot>/<i>/...`.
Выражения, метки case, init/update for, ресурсы try — точный исходный текст (TokenRange) вместе с
комментариями внутри. Модификаторы и аннотации переменной / foreach / catch — префикс `type`
(`final int`, `@A final var`); сам тип печатается без комментариев. Switch: `case.label` как в коде
(`1, 2`, `C c when c.r() > 0`, `null, default`), `arrow="true"` для `->`; switch-выражения — текст.
В `raw` (исходный текст с комментариями): synchronized, локальные типы, assert, labeled, `;`, голый `{}`,
`super(...)`/`this(...)`, объявление нескольких переменных (`int x, y;`).
JavaParser (language level 21) настраивает вызывающий; локальные enum/interface JavaParser 3.26.2 не разбирает.

Комментарии -> блоки `comment` (text без `//`, `/* */`), по позиции в исходнике:
- между операторами — в своём слоте; в конце строки — следующим блоком после оператора;
- перед `case`/`default` — в слоте `cases` перед этим case; между меткой и операторами — в начале `body` case;
- перед `catch` и перед `finally` — в слоте `catches` (он охватывает всё от `}` тела try до `finally`):
  BlocksToJava пишет comment из `catches` перед следующим catch, а хвостовые — перед `finally`;
- в заголовке оператора (`if (x) /* c */ {`, `} /* c */ else`, `int /* c */ y`) — блоком прямо перед оператором;
- внутри выражения (`foo(x /* c */)`, лямбда, анонимный класс) — остаётся в его тексте.
Тест на всём `samples/` и на этих случаях проверяет: каждый комментарий тела встречается в дереве
столько же раз, сколько в исходнике (блоком comment или дословно в тексте поля).

`BlocksToJava` (обратно): `replaceMethod(fileText, methodId, tree)` -> новый текст файла. Неизменённое дерево
(`sameTree`: kind/fields/slots, без id/span/issues; нет `signature` в дереве — значит, исходная) -> исходный текст байт в байт. Иначе в тексте подменяется только
`{...}` тела (и заголовок, если изменилась `signature`) — сплайсом по смещениям токенов, весь остальной файл не трогается
(надёжнее LexicalPreservingPrinter на Java 21). Стиль: отступ строки заголовка + шаг из первого оператора тела (таб/4 пробела),
перевод строки файла (CRLF сохраняется). Генерация: тела всегда в `{}`, `else` с единственным if -> `else if`,
arrow-case с одним expr/throw — в строку; comment из исходника — ровно в исходном виде (`//`, `/* */`, `/** */`, текст без изменений, сопоставление по тексту блока); новый — `// t`, многострочный — `/* */`; новый/изменённый comment с `\u` не генерируется — `UnsafeCommentException` (id блока; javac раскрыл бы `\u000a`), неизменённый выводится как в исходнике; comment из `catches` — перед
следующим catch, хвостовые — перед finally; try без catch/finally/ресурсов получает `finally {}`; raw — текст как есть.
Многострочные тексты полей сохраняют свои внутренние отступы. `body(method, Style)` — только текст тела.
`MethodLocator.find(cu, "pkg.Outer$Inner.m~N" | "...<init>~N")` — метод по id дерева проекта (как `TreeBuilder`).
Файлы, которые JavaParser не разбирает (локальные enum/interface, 3.26–3.28), остаются текстом без блоков (см. source).

Дальше: BE-07 валидация текста нод.

Зависит от: model, source.

Тесты: `./gradlew :blocks:test` — `RoundTripCorpusTest` (§5, входит в build): весь `samples/roundtrip` (LF и CRLF) и
`samples/demo` — тела всех методов заново из блоков -> javac -> тот же stdout/код выхода (`expected/`, `tests/*.out`),
повторный разбор даёт то же дерево, неизменённое дерево — файл байт в байт; `BlocksToJavaTest` — каждый kind, комментарии,
сигнатура, CRLF, табы, правка одного метода не трогает остальные. `AstToBlocksTest` — эталон `contract/fixtures/method-view.merge.json` (без issues/collapsed),
каждый kind, raw, arrow/pattern switch, комментарии, корпус `samples/`.
