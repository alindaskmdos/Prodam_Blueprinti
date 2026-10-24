import { useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { FieldSpec } from './blockEdit';
import { JavaText } from './JavaText';
import styles from './MethodCanvas.module.css';

export interface NodeTextEditorProps {
  specs: FieldSpec[];
  initial: Record<string, string>;
  /** PUT в полёте: поля только для чтения (без потери фокуса). */
  saving: boolean;
  /** Метод изменился извне: Enter и blur не отправляют, предлагается применить к новому дереву или отменить. */
  stale?: boolean;
  onApply: (draft: Record<string, string>) => void;
  onRebase?: (draft: Record<string, string>) => void;
  onCancel: () => void;
}

/**
 * Инлайн-редактор текста ноды: прозрачная textarea поверх подсвеченного pre (лёгкая подсветка Java, без Monaco).
 * Enter — применить (Shift+Enter — перенос строки в многострочных полях), Esc — отмена,
 * уход фокуса из редактора — применить.
 */
export function NodeTextEditor({ specs, initial, saving, stale = false, onApply, onRebase, onCancel }: NodeTextEditorProps) {
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const showLabels = specs.length > 1;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, spec: FieldSpec) => {
    // Клавиши не уходят в React Flow (Esc снимает выделение, стрелки двигают холст).
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && !(spec.multiline && e.shiftKey)) {
      e.preventDefault();
      if (stale) onRebase?.(draft);
      else onApply(draft);
    }
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    // Переход между полями одного редактора — не blur редактора.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    // Устаревшее дерево: уход фокуса ничего не отправляет, черновик остаётся до выбора пользователя.
    if (!stale) onApply(draft);
  };

  return (
    <div className={`${styles.editor} nodrag nopan nowheel`} onBlur={onBlur} data-testid="node-editor">
      {specs.map((spec, i) => {
        const value = draft[spec.key] ?? '';
        return (
          <label key={spec.key} className={styles.editorField}>
            {showLabels && <span className={styles.editorLabel}>{spec.label}</span>}
            <span className={styles.javaInput}>
              <pre className={styles.javaInputHl} aria-hidden="true">
                {spec.java ? <JavaText text={value} /> : value}
                {/* Перенос в конце, чтобы последняя пустая строка занимала место. */}
                {'\n'}
              </pre>
              <textarea
                className={styles.javaInputArea}
                value={value}
                aria-label={spec.label}
                spellCheck={false}
                autoComplete="off"
                autoFocus={i === 0}
                readOnly={saving}
                rows={1}
                onChange={(e) => setDraft((d) => ({ ...d, [spec.key]: e.target.value }))}
                onKeyDown={(e) => onKeyDown(e, spec)}
                onFocus={(e) => {
                  if (i === 0) e.currentTarget.setSelectionRange(value.length, value.length);
                }}
              />
            </span>
          </label>
        );
      })}
      {stale ? (
        <div className={styles.staleNote} role="alert">
          <span>Метод изменился (код или исправление). Ваш текст ещё не отправлен.</span>
          <span className={styles.staleActions}>
            {/* mousedown без смены фокуса — иначе blur редактора. */}
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onRebase?.(draft)}>
              Применить к новому
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onCancel}>
              Отменить
            </button>
          </span>
        </div>
      ) : (
        <span className={styles.editorHint}>{saving ? 'сохранение…' : 'Enter — применить · Esc — отмена'}</span>
      )}
    </div>
  );
}
