# layout

Каркас экрана редактора по `docs/design/screens/Editor.dc.html` (ТЗ §6, §7).

- `EditorLayout` — шапка + три колонки (дерево | центр | анализ), центр делится на холст и нижнюю панель.
  Слоты: `header`, `left`, `canvas`, `right`, `bottom`. Разделители перетаскиваются (react-resizable-panels),
  размеры запоминаются в localStorage (`jb-editor-columns`, `jb-editor-center`).
  Левая, правая и нижняя панели сворачиваются (`collapsible`, imperative API): состояние — `useLayoutStore` (`collapsed`, `toggle`, `toggleCanvasOnly` = «Только схема», `revealArea`). Свёрнутая панель — узкая полоса с подписью, клик разворачивает; перетаскивание разделителя тоже сворачивает/разворачивает (синхронизация через `onCollapse`/`onExpand`); размеры и свёрнутость запоминает `autoSaveId`. Содержимое свёрнутой панели не размонтируется. `showPanel` из `app/store.ts` разворачивает область (`revealArea`): вкладка в свёрнутой панели становится видна. Горячие клавиши (`src/app/layoutShortcuts.ts`, по `event.code`) и команды палитры `layout.*` (`commands.ts`): Ctrl+B — проект, Ctrl+J — нижняя, Ctrl+Alt+B — анализ (на Windows Ctrl+Alt = AltGr, т.е. AltGr+B), Ctrl+обратный слэш — «Только схема».
- `CollapseButton` — кнопка «Свернуть» в шапке панели (у `PanelTabs` — проп `collapseArea`).
- `EditorHeader` — логотип, имя проекта (`projectName`, id в подсказке `projectId`) и версия, кнопки показа панелей и «Только схема», точка входа; «Загрузить проект» / «Экспорт» активны, если переданы `onUpload` / `onExport` (App вызывает команды `project.upload` / `project.export`); «▶ Запуск» / «Проверить поведение» — `onRun` / `onVerify` (App вызывает команды `project.run` / `project.verify`); `busy` ('run' | 'verify' | 'fix') блокирует обе кнопки и показывает индикатор, `sandboxDisabledReason` — плашка «Песочница недоступна» и неактивные кнопки (причина в `title`).
- `CanvasSlot` — рамка холста: вкладка выбранного метода (`useAppStore().selectedMethodId`, id `CANVAS_METHOD_TAB`) и `children` — холст; без него заглушка «Выберите метод в дереве проекта». `views` — доп. вкладки центральной зоны (реестр `area: 'canvas'`: UML, Зависимости), `activeId`/`onActiveChange` — App держит активную в `activePanels.canvas`; выбор метода (seq) возвращает на схему метода.
- `PanelTabs` — панель с вкладками из списка `TabDef {id, title, component}` (`role=tablist/tab/tabpanel`); вкладки в одну строку, названия длиннее 10 символов при нехватке места сжимаются с многоточием (полный текст в `title`). Управляемый режим: `activeId` + `onActiveChange` (App держит активную нижнюю вкладку в `useAppStore().activePanels`, `showPanel('bottom', 'bottom.tests')` переключает на тесты).
- `stubPanel(text)` / `PanelStub` — заглушки вкладок для реестра `src/app/panels.ts`.

Вкладки не регистрируются здесь: реестр — `src/app/panels.ts` (`area: 'right' | 'bottom' | 'canvas'`), сборка экрана — `src/app/App.tsx`.
В vitest `react-resizable-panels` берётся браузерной сборкой (`vite.config.ts`: `resolve.conditions` + `server.deps.inline` под VITEST): серверная не считает раскладку, и `collapse()` падает.
Вкладка «Консоль» (`src/app/ConsolePanel.tsx`) показывает вывод последнего запуска (`useTestsStore().run`) или подсказку «Нажмите ▶ Запуск…».
Подключено (`src/app/methodViews.tsx`):
- холст — `SelectedMethodCanvas`: `MethodCanvas` (editor-nodes) для `selectedMethodId`, без ремоунта: версию берёт из store и на чужую правку сам перезагружает блоки (`adoptVersion`), черновик и тост 409 сохраняются; `onMutation` (своя правка нод) → анализ из ответа в стор анализа + перезагрузка дерева. Без метода — заглушка CanvasSlot. Проп `canvas` у `App` подменяет холст (тесты);
- `bottom.code` — `SelectedMethodCode`: `CodeEditor` (editor-code) для файла выбранного метода (`findMethodFile` из project-tree); `onVersion` (только рост версии) → `setVersion`, `onMutation` → анализ из ответа в стор анализа + перезагрузка дерева, `onConflict` (409) → перезагрузка дерева. Анализ перезагружается сам по смене `version`.
Подключить новую фичу: заменить `component` заглушки в `panels.ts`.

Тесты: `EditorLayout.test.tsx` (сворачивание, «Только схема», `revealArea`), `src/app/layoutPanels.test.tsx` (горячие клавиши, команды, showPanel разворачивает панель, имя проекта, вкладка «Консоль»), `src/app/App.test.tsx` (каркас на MSW; выбор метода → ноды холста, вкладка «Код Java» с текстом OrderService, правка → рост версии и перезагрузка дерева/холста/анализа, 409 → перезагрузка дерева; Monaco подменён textarea), `src/app/panels.test.tsx` (реестр и `PanelTabs`).
