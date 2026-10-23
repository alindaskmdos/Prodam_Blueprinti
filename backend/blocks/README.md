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

Дальше: BE-06 `BlocksToJava` + `RoundTripCorpusTest` на `samples/roundtrip/`, BE-07 валидация.

Зависит от: model, source.

Тесты: `./gradlew :blocks:test` — эталон `contract/fixtures/method-view.merge.json` (без issues/collapsed),
каждый kind, raw, arrow/pattern switch, комментарии, корпус `samples/`.
