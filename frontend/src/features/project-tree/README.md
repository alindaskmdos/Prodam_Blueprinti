# project-tree

Дерево проекта в левой колонке и формы структуры (ТЗ §7, FE-10; решение 2026-10-25: формы правят текст файла и шлют PUT files).

- `ProjectTree({ client, projectId })` — пакеты → классы → поля `f`, конструкторы `c`, методы `m` (бейдж `complexity`). Каретка сворачивает класс; клик по имени класса или полю — `selectStructure` (форма во вкладке «Свойства»); клик по методу → `useAppStore().selectMethod(id)`. «+» в шапке — диалог «Новый класс».
- `useProjectTree` / `useTreeStore` / `loadProjectTree` / `reloadProjectTree` / `findMethodFile` / `resetTreeState` — как раньше; `applyTree(projectId, tree, version)` — дерево из ответа правки без GET; `getTreeClient()`.
- `StructurePanel` — вкладка «Свойства» (`STRUCTURE_PANEL_ID`, правая панель): форма класса (имя, kind, видимость, флаги, typeParams, extends, implements), поля (тип, имя, модификаторы), метода/конструктора (модификаторы, typeParams, returnType, имя, параметры с ↑↓×, throws). Без headerStart/headerEnd (старый бэк), без span поля или с общим span (`int a, b;`) — только чтение с пояснением. Комментарии в заголовке — предупреждение, что пропадут.
- `StructureDialog` (монтируется в `ProjectTree`) — «Новый класс / поле / конструктор / метод», «Удалить …?». Команды палитры `structure.*` в `app/commands.ts`.
- Общий API выбора класса: `selectClass(fqn)` (`pkg.Outer.Inner` = UmlClass.id) → класс выбран, открыта «Свойства»; `currentClassRef()`; `findClassByFqn`.
- `structure/structureStore.ts` — выбор класса/поля, диалог, `saveFileEdit(path, transform)`: GET files → дерево той же версии (иначе перезагрузка) → правка → PUT files. 200 → `applyTree` + версия в store (Monaco, холст и анализ перечитывают по версии); 409 → перезагрузка дерева и ошибка; 422 → ошибка со строкой.
- `structure/edits.ts`, `headers.ts`, `javaText.ts` — чистые функции: заголовок заменяется в [headerStart, headerEnd), пробелы перед `{`/`;` сохраняются; аннотации, компоненты record, permits, неизменённые параметры (`final`, аннотации) и инициализатор поля — байт в байт. Вставка: поле — после последнего поля, конструктор/метод — перед `}` класса с отступом соседей (enum без `;` получает `;`), тело метода — `return` значения по умолчанию; у interface — метод без тела, поле с инициализатором. Удаление — строки объявления целиком с javadoc; объявление на одной строке с другим кодом — отказ.
- Ограничение: новый класс дописывается непубличным в конец файла пакета — PUT files не создаёт новых файлов (404).

Тесты: `ProjectTree.test.tsx`; `structure/edits.test.ts` (однострочный метод, `{` на новой строке, аннотации, CRLF, суррогатные пары, `;`-методы, record, enum, вставка/удаление, фикстуры); `structure/StructurePanel.test.tsx` (формы → PUT files на MSW, 409, 422, только чтение, команды и диалоги, `selectClass`).
