# project-tree

Дерево проекта в левой колонке (ТЗ §7). Сейчас только просмотр; формы классов/полей/методов — FE-10.

- `ProjectTree({ client, projectId })` — пакеты → классы (kind, если не class) → поля `f`, конструкторы `c`, методы `m`
  с бейджем `complexity` (красный, если `issueCount > 0`). Пакеты и классы сворачиваются кликом.
- Клик по методу/конструктору → `useAppStore().selectMethod(id)` (id = `MethodNode.id`, напр. `com.demo.service.OrderService.merge~0`);
  выбранный подсвечен, `aria-pressed=true`.
- Класс, выбранный в диаграммах (`useAppStore().selectedClass.id` = `ClassNode.fqn`, FE-16), подсвечен и прокручен в видимую область; у строки класса `data-class-id`.
- `useProjectTree(client, projectId)` — `GET /projects/{projectId}/tree` в общий `useTreeStore` (zustand, состояние loading/error/ok); версия из ответа → `setVersion`, только если новее текущей.
- `reloadProjectTree()` — перезагрузить дерево открытого проекта (старое видно до ответа); `findMethodFile(tree, methodId)` — путь файла метода/конструктора; `resetTreeState()` — тесты.

Типы — `Schemas['ProjectTree'|'ClassNode'|'MethodNode']` из `features/api`.

Тесты: `ProjectTree.test.tsx` — дерево из `contract/fixtures/tree.json` (MSW), выбор метода, сворачивание, ошибка 404.
