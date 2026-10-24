import { Suspense, lazy, useEffect } from 'react';
import { api, type ApiClient, type Schemas } from '../api';
import type { ConflictInfo, FileSyncStatus } from './fileSync';
import type { RevealLines } from './reveal';
import { useFileSync } from './useFileSync';
import styles from './CodeEditor.module.css';

// Monaco тяжёлый — грузится отдельным чанком при первом показе редактора.
const MonacoView = lazy(() => import('./MonacoView'));

/** Сколько висит тост о конфликте версий. */
const TOAST_MS = 6000;

export interface CodeEditorProps {
  projectId: string;
  /** Путь файла как в архиве (ProjectFile.path). */
  path: string;
  client?: ApiClient;
  /** Версия проекта, известная приложению (после правок нод/фиксов) — берётся, если новее. */
  version?: number;
  onVersion?: (version: number) => void;
  onMutation?: (result: Schemas['MutationResult']) => void;
  onConflict?: (error: Schemas['Error']) => void;
  debounceMs?: number;
  /** Подсветить строки и прокрутить к ним (клик по ноде, выбор проблемы, FE-05); null — снять подсветку. */
  reveal?: RevealLines | null;
  /** Пользователь поставил курсор на строку (мышь/клавиатура) — для подсветки ноды на холсте. */
  onCursorLine?: (line: number) => void;
}

const STATUS_TEXT: Record<FileSyncStatus, string> = {
  loading: 'загрузка…',
  synced: 'синхронизировано',
  pending: 'есть правки',
  saving: 'сохранение…',
  'parse-error': 'синтаксическая ошибка',
  error: 'ошибка',
};

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function conflictText(c: ConflictInfo): string {
  const versions =
    c.clientVersion !== undefined && c.serverVersion !== undefined
      ? `Ваша правка относилась к версии ${c.clientVersion}, сейчас ${c.serverVersion}. `
      : '';
  return `${versions}Состояние перезагружено.`;
}

/** Скопировать отложенные правки в буфер обмена (может быть недоступен — тогда молча ничего). */
function copyText(text: string): void {
  try {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  } catch {
    // нет Clipboard API
  }
}

/** Код Java файла в Monaco с синхронизацией: правка → 500 мс → PUT files. */
export function CodeEditor({
  client = api,
  projectId,
  path,
  version,
  onVersion,
  onMutation,
  onConflict,
  debounceMs,
  reveal = null,
  onCursorLine,
}: CodeEditorProps) {
  const { state, edit, dismissConflict, takeTheirs, keepMine } = useFileSync({
    client,
    projectId,
    path,
    debounceMs,
    version,
    onVersion,
    onMutation,
    onConflict,
  });
  const { status, loadedText, loadSeq, parseError, error, conflict, stale } = state;

  useEffect(() => {
    if (!conflict) return;
    const t = setTimeout(dismissConflict, TOAST_MS);
    return () => clearTimeout(t);
    // Перезапуск таймера на каждый новый 409.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflict?.seq]);

  return (
    <section className={styles.root} aria-label={`Код ${path}`}>
      <div className={styles.bar}>
        <span className={styles.file} title={path}>
          {fileName(path)}
        </span>
        <span className={styles.status} data-status={status} role="status">
          ● {STATUS_TEXT[status]}
        </span>
      </div>

      {parseError && (
        <div className={styles.parseError} role="alert">
          <span className={styles.parseErrorTitle}>Синтаксическая ошибка в коде</span>
          <span>
            {fileName(path)}
            {parseError.line ? `:${parseError.line}` : ''} — {parseError.message}. Схема осталась прежней, пока код не
            исправлен.
          </span>
        </div>
      )}
      {stale && (
        <div className={styles.stale} role="alert">
          <span className={styles.staleTitle}>
            {stale.reason === 'conflict'
              ? 'Проект изменён — ваши правки не отправлены'
              : 'Файл изменён (на схеме или фиксом). Ваши правки не отправлены'}
          </span>
          <span>
            В редакторе новый текст, он только для чтения, пока вы не выберете. «Оставить мои» вернёт ваш текст и
            перезапишет изменения.
          </span>
          <div className={styles.staleActions}>
            <button type="button" onClick={takeTheirs}>
              Взять новый текст
            </button>
            <button type="button" onClick={keepMine} disabled={status === 'loading'}>
              Оставить мои
            </button>
            <button type="button" onClick={() => copyText(stale.text)}>
              Скопировать
            </button>
          </div>
        </div>
      )}
      {error && status !== 'loading' && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <div className={styles.editor}>
        {loadedText !== null ? (
          <Suspense fallback={<div className={styles.placeholder}>Загрузка редактора…</div>}>
            <MonacoView
              key={`${projectId}:${path}`}
              text={loadedText}
              loadSeq={loadSeq}
              parseError={parseError}
              onChange={edit}
              readOnly={stale !== null}
              reveal={reveal}
              onCursorLine={onCursorLine}
            />
          </Suspense>
        ) : (
          status === 'loading' && <div className={styles.placeholder}>Загрузка файла…</div>
        )}
      </div>

      {conflict && (
        <div className={styles.toast} role="alert" key={conflict.seq}>
          <span className={styles.toastIcon} aria-hidden="true">
            !
          </span>
          <div className={styles.toastBody}>
            <span className={styles.toastTitle}>Проект изменён</span>
            <span className={styles.toastText}>{conflictText(conflict)}</span>
          </div>
          <button type="button" className={styles.toastClose} onClick={dismissConflict} aria-label="Закрыть">
            ×
          </button>
        </div>
      )}
    </section>
  );
}
