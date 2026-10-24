# editor-code

Код Java файла в Monaco + синхронизация с бэкендом (ТЗ §5, §12 «Синхронизация»).

- `<CodeEditor projectId path />` (`index.ts`) — панель «Код Java»: Monaco, статус «● синхронизировано», сообщение о синтаксической ошибке, тост 409. Пропсы: `client?`, `version?` (версия, известная приложению — берётся, если новее), `onVersion`, `onMutation` (`MutationResult`: новое дерево и анализ), `onConflict` (приложению перезагрузить состояние), `debounceMs?` (по умолчанию 500).
- `fileSync.ts` — `FileSync`, логика без React и Monaco: GET files → текст и версия; правка → debounce 500 мс → PUT files с полным текстом и текущей версией (в полёте максимум один запрос, правки во время запроса уходят после ответа); 200 → новая версия; 409 → `conflict`, неотправленные правки отброшены, текст перезагружен (`loadSeq++`); 422 PARSE_ERROR → `parseError {line, message}`, версия не меняется. Внешняя версия новее (`adoptVersion`: правка нод, фикс) → GET files и новый текст в редакторе (не только версия — иначе PUT со старым текстом затёр бы чужую правку); PUT в полёте — проверка после ответа; неотправленный текст (debounce, набранный во время PUT, отклонённый 422) не уходит, а откладывается в `stale {text}` — плашка «Файл изменён… Ваши правки не отправлены»: «Взять новый текст» (`takeTheirs`), «Оставить мои» (`keepMine`: свой текст в редактор и PUT с актуальной версией), «Скопировать». Одинаковая/меньшая версия — ничего; версия, выросшая во время GET, догоняется повторным GET.
- `useFileSync.ts` — React-обёртка (`useSyncExternalStore`), экземпляр на `projectId + path`.
- `MonacoView.tsx` — только Monaco: подмена текста при смене `loadSeq` без события правки, маркер ошибки по `line`. Грузится лениво отдельным чанком.
- `monacoSetup.ts` — локальная сборка Monaco без CDN (`loader.config({ monaco })`, ядро + подсветка Java + editor.worker), тема `jb-graphite` на токенах `tokens.css`, шрифт JetBrains Mono.

Версия проекта хранится в `FileSync`; общий стор подключается через `version` / `onVersion`.
Текст из ответа PUT (`fileText`) в редактор не подставляется, чтобы не сбивать курсор.

Тесты: `fileSync.test.ts` (fake timers + MSW), `CodeEditor.test.tsx` (MonacoView подменён textarea).
Моки: PUT files по умолчанию в `src/mocks/handlers.ts`, `scenarios.conflictOnFile`; GET files по умолчанию нет — в фикстурах нет текста файлов.
- `monaco.ts` — отдельная точка входа для других фич: `setupMonaco`, `GRAPHITE_THEME`, `CODE_FONT` (напр. JUnit-редактор tests-panel). В `index.ts` не реэкспортируется, чтобы monaco-editor не попал в основной чанк; импортировать `../editor-code/monaco` только из лениво загружаемых модулей.
