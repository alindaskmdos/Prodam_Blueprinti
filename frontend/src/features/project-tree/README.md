# project-tree

Дерево проекта в левой колонке (ТЗ §7). Сейчас только просмотр; формы классов/полей/методов — FE-10.

- `ProjectTree({ client, projectId })` — пакеты → классы (kind, если не class) → поля `f`, конструкторы `c`, методы `m`
  с бейджем `complexity` (красный, если `issueCount > 0`). Пакеты и классы сворачиваются кликом.
- Клик по методу/конструктору → `useAppStore().selectMethod(id)` (id = `MethodNode.id`, напр. `com.demo.service.OrderService.merge~0`);
  выбранный подсвечен, `aria-pressed=true`.
- `useProjectTree(client, projectId)` — `GET /projects/{projectId}/tree`, состояние loading/error/ok; версия из ответа → `setVersion`.

Типы — `Schemas['ProjectTree'|'ClassNode'|'MethodNode']` из `features/api`.

Тесты: `ProjectTree.test.tsx` — дерево из `contract/fixtures/tree.json` (MSW), выбор метода, сворачивание, ошибка 404.
