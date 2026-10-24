# layout

Каркас экрана редактора по `docs/design/screens/Editor.dc.html` (ТЗ §6, §7).

- `EditorLayout` — шапка + три колонки (дерево | центр | анализ), центр делится на холст и нижнюю панель.
  Слоты: `header`, `left`, `canvas`, `right`, `bottom`. Разделители перетаскиваются (react-resizable-panels),
  размеры запоминаются в localStorage (`jb-editor-columns`, `jb-editor-center`).
- `EditorHeader` — логотип, проект и версия, точка входа; «Загрузить проект» / «Экспорт» активны, если переданы `onUpload` / `onExport` (App вызывает команды `project.upload` / `project.export`); запуск и проверка пока неактивны (FE-13).
- `CanvasSlot` — рамка холста: полоса с выбранным методом (`useAppStore().selectedMethodId`) и `children` — холст FE-03; без него заглушка.
- `PanelTabs` — панель с вкладками из списка `TabDef {id, title, component}` (`role=tablist/tab/tabpanel`).
- `stubPanel(text)` / `PanelStub` — заглушки вкладок для реестра `src/app/panels.ts`.

Вкладки не регистрируются здесь: реестр — `src/app/panels.ts` (`area: 'right' | 'bottom'`), сборка экрана — `src/app/App.tsx`.
Подключить фичу: заменить `component` заглушки в `panels.ts` (напр. `bottom.code` → редактор FE-04), холст — проп `canvas` у `App`.

Тесты: `src/app/App.test.tsx` (каркас на MSW), `src/app/panels.test.tsx` (реестр и `PanelTabs`).
