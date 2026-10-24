# layout

Каркас экрана редактора по `docs/design/screens/Editor.dc.html` (ТЗ §6, §7).

- `EditorLayout` — шапка + три колонки (дерево | центр | анализ), центр делится на холст и нижнюю панель.
  Слоты: `header`, `left`, `canvas`, `right`, `bottom`. Разделители перетаскиваются (react-resizable-panels),
  размеры запоминаются в localStorage (`jb-editor-columns`, `jb-editor-center`).
- `EditorHeader` — логотип, проект и версия, точка входа; «Загрузить проект» / «Экспорт» активны, если переданы `onUpload` / `onExport` (App вызывает команды `project.upload` / `project.export`); запуск и проверка пока неактивны (FE-13).
- `CanvasSlot` — рамка холста: полоса с выбранным методом (`useAppStore().selectedMethodId`) и `children` — холст; без него заглушка «Выберите метод в дереве проекта».
- `PanelTabs` — панель с вкладками из списка `TabDef {id, title, component}` (`role=tablist/tab/tabpanel`).
- `stubPanel(text)` / `PanelStub` — заглушки вкладок для реестра `src/app/panels.ts`.

Вкладки не регистрируются здесь: реестр — `src/app/panels.ts` (`area: 'right' | 'bottom'`), сборка экрана — `src/app/App.tsx`.
Подключено (`src/app/methodViews.tsx`):
- холст — `SelectedMethodCanvas`: `MethodCanvas` (editor-nodes) для `selectedMethodId`, без ремоунта: версию берёт из store и на чужую правку сам перезагружает блоки (`adoptVersion`), черновик и тост 409 сохраняются; `onMutation` (своя правка нод) → анализ из ответа в стор анализа + перезагрузка дерева. Без метода — заглушка CanvasSlot. Проп `canvas` у `App` подменяет холст (тесты);
- `bottom.code` — `SelectedMethodCode`: `CodeEditor` (editor-code) для файла выбранного метода (`findMethodFile` из project-tree); `onVersion` (только рост версии) → `setVersion`, `onMutation` → анализ из ответа в стор анализа + перезагрузка дерева, `onConflict` (409) → перезагрузка дерева. Анализ перезагружается сам по смене `version`.
Подключить новую фичу: заменить `component` заглушки в `panels.ts`.

Тесты: `src/app/App.test.tsx` (каркас на MSW; выбор метода → ноды холста, вкладка «Код Java» с текстом OrderService, правка → рост версии и перезагрузка дерева/холста/анализа, 409 → перезагрузка дерева; Monaco подменён textarea), `src/app/panels.test.tsx` (реестр и `PanelTabs`).
