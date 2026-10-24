# editor-nodes

Схема метода в стиле Blueprints (Graphite), пока только просмотр (FE-03). React Flow (`@xyflow/react`) + ELK.js.

- `<MethodCanvas projectId methodId client? />` — грузит `GET /projects/{projectId}/methods/{methodId}/blocks` и рисует схему. `<MethodGraph view />` — то же для готового `MethodView`. Контейнеру нужна высота (компонент тянется на 100%).
- `blocksToGraph(root, { methodBadge })` — чистая функция: дерево `Block` → ноды/рёбра без координат. Корень `method` — заголовок с бейджем сложности, тело — цепочка сверху вниз. Контейнеры (`if/while/dowhile/for/foreach/switch/case/try/catch`) — group-ноды: заголовок `<id>#head` и ветки. Одна ветка — цепочка прямо в контейнере; несколько — рамки `<id>#slot:<key>` рядом (`да`/`нет`, `try`/`catch`/`finally`). `switch.cases`, `try.catches` — параллельные ветки. Пустые слоты не рисуются. `raw` — пунктирная рамка с исходным текстом, `comment` — стикер. Неизвестный kind (бэк новее типов) — raw-нода с `fields.text`, иначе JSON полей; с непустыми слотами — контейнер, вложенное не теряется. id нод = `Block.id` (нет id — путь в дереве).
- `layoutGraph(graph)` — ELK layered DOWN; в браузере в web worker (`elk-worker.min.js?url`), без Worker (тесты) или если воркер не создаётся — `elk.bundled` в основном потоке. Неудачное создание не кэшируется. Координаты — относительно родительской группы.
- `toFlow(layout)` — ноды/рёбра React Flow: без перетаскивания, соединения, удаления, переподключения рёбер.
- `kinds.ts` — заголовки, цвета (`--jb-node-*` из `tokens.css`) и слоты по kind; `blockText.ts` — текст ноды из `fields`; `highlightJava.ts` — лёгкая подсветка Java.
- Ноды: `nodes.tsx` (`BlockNode`, `RawNode`, `CommentNode`, `ContainerNode`, `SlotNode`), регистрация — `nodeTypes.ts`. Стили — `MethodCanvas.module.css`.

Не здесь: сворачивание, мини-карта, переключатель комментариев (FE-06), правка (FE-07+), подсветка строка ↔ нода (FE-05).

Тесты: `blocksToGraph.test.ts` (все kind, вложенность, raw, comment, фикстура), `layout.test.ts` (ELK: дети в границах родителя, без перекрытий), `blockText.test.ts`, `MethodCanvas.test.tsx` (MSW на `contract/fixtures/method-view.merge.json`). `npm test`.
