# upload

Экран загрузки проекта и диалог экспорта (ТЗ §11; макеты `docs/design/screens/Upload.dc.html`, `Export.dc.html`).

- `UploadScreen` — drag&drop, «Выбрать файлы» (.java/.zip/.jar), «Выбрать папку» (`webkitdirectory`). Шаги разбора, предупреждения `LoadWarning` (внимание / тесты / пропущено), отказы по `Error.code` (`NO_SOURCES`, `DUPLICATE_FQN` + `files`, `ZIP_SLIP`, `LIMIT_EXCEEDED`, …). Без предупреждений — сразу `onOpen(project, name)` (`name` — имя папки/архива/файла: контракт имени проекта не содержит; у набора файлов без общей папки его нет, шапка показывает id), иначе кнопка «Открыть проект →».
- `ExportDialog` — `.zip` с галочкой «настройки Java Blueprints» (`includeSettings`, по умолчанию вкл.) и `.jar` (Main-Class из `Project.mainClasses`, подпись «требует Java 21+»). Кнопка .jar неактивна с причиной: нет main, 422 `COMPILE_ERROR` (до новой версии проекта), 501 (бэк ещё не собирает jar). 422 `AMBIGUOUS_MAIN` → «выберите точку входа» (+ `details.mainClasses`), прочие коды — `message`. Неизвестный код `LoadWarning` — плашка «внимание», текст как есть.
- `projectApi.ts` — `uploadProject` (multipart: `files`, для папки ещё `paths` в том же порядке — `buildUploadForm`), `exportProject` (blob + имя из `Content-Disposition`).
- `collectFiles.ts` — `fromFileList` (webkitRelativePath), `fromDataTransfer` (рекурсивный обход папки из drop).
- `uploadUi.ts` — `useUploadUi`: `uploadOpen` / `exportOpen`; команды `project.upload` / `project.export` в `src/app/commands.ts`.

Встраивание: `App` показывает `UploadScreen`, пока в store нет `projectId` (или открыт `uploadOpen`); после загрузки — `openProject(id, version, name)`. Кнопки шапки — через `runCommand`.

Моки (`src/mocks/handlers.ts`): POST /projects → `project.json`, GET export → байты; сценарии `uploadClean`, `uploadWarnings`, `uploadDuplicateFqn`, `uploadNoSources`, `uploadZipSlip`, `uploadLimitExceeded`, `exportJarCompileError`, `exportJarNotImplemented`.

Тесты: `UploadScreen.test.tsx`, `ExportDialog.test.tsx`, `collectFiles.test.ts`. В jsdom тело multipart с File не сериализуется — состав формы проверяется через `buildUploadForm`.
