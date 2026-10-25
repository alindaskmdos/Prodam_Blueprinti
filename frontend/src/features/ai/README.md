# ai

Опциональный ИИ-слой (ТЗ §14а.10, контракт CT-04). Кнопки появляются только по `GET /capabilities`: `llm=true` и функция в `features` (`explain` | `fix` | `edit-node`); иначе кнопок **нет** (не disabled). Без загрузки capabilities (ошибка, ещё не пришло) — тоже нет.

- `capabilities.ts` — `useCapabilitiesStore`, `useLoadCapabilities(client)` (в `App`), `useAiFeature(feature)`, `hasAiFeature`.
- `aiStore.ts` — диалог ИИ и вызовы: `explain` (POST `…/methods/{id}/explain` → markdown), `openEdit` → `propose` (POST `…/ai-edit`) → `apply` (PUT `/files?path=` с `text` и `version` **из ответа**; 200 → версия, анализ, перезагрузка дерева; 409 → «Проект изменился», перезагрузка состояния; 422 → сообщение со строкой). «Отмена» и закрытие ничего не меняют; сразу ничего не применяется (Quality Gate тут не защищает — правка меняет поведение).
- `AiDialog.tsx` — «Объясни метод» (мини-markdown: абзацы, **жирный**, `код`) и «Изменить текстом (ИИ)» (инструкция → дифф → «Применить» / «Отмена»). Рендерится в `App`.
- `aiError.ts` — текст ошибки: `message` бэка (+ «Повторите через N с» из `details.retryAfterSec`, если числа нет в тексте) для 429 RATE_LIMITED и 503 LLM_UNAVAILABLE.
- «Предложить фикс (ИИ)» (карточка проблемы в `analysis-panel`) → `useFixStore.applyAi` → POST `…/issues/{id}/ai-fix` и **тот же** Quality Gate-поток, что у обычного фикса (`features/fix`, подпись «Фикс «ИИ»»).

Кнопки зарегистрированы командами `ai.explain` («Объяснить метод (ИИ)», есть в палитре), `ai.edit` (`blockId`), `ai.fix` (`issueId`) в `src/app/commands.ts`. На ноде: «Объясни метод» — только у ноды метода, «ИИ-правка» (aria-label «Изменить текстом (ИИ): …») — у ноды блока и метода (корень = правка всего метода); видны при наведении/выборе ноды.

Моки: `GET /capabilities` по умолчанию `capabilities.on.json`; сценарии `aiOff`, `aiRateLimited`, `llmUnavailable`.

Тесты: `ai.test.ts` (текст ошибки, `hasAiFeature`), `src/app/aiActions.test.tsx` (кнопок нет при llm=false / без функции, explain, 429/503, ai-edit: дифф → PUT только после «Применить», «Отмена», 409; ai-fix через Quality Gate).
