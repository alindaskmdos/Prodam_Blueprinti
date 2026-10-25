import { useEffect, useMemo, useState } from 'react';
import { parseUnifiedDiff } from '../fix/gate';
import { useAiStore, type EditDialog, type ExplainDialog } from './aiStore';
import { renderMarkdown } from './markdown';
import styles from './Ai.module.css';

/** Диалоги ИИ: «Объясни метод» (текст) и «Изменить текстом (ИИ)» (инструкция → дифф → Применить / Отмена). */
export function AiDialog() {
  const dialog = useAiStore((s) => s.dialog);
  const close = useAiStore((s) => s.close);
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, close]);
  if (!dialog) return null;
  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section role="dialog" aria-modal="true" aria-label={dialog.title} className={styles.dialog} data-testid="ai-dialog">
        <header className={styles.head}>
          <span className={styles.title}>{dialog.title}</span>
        </header>
        {dialog.kind === 'explain' ? <ExplainBody d={dialog} /> : <EditBody d={dialog} />}
      </section>
    </div>
  );
}

function ExplainBody({ d }: { d: ExplainDialog }) {
  const close = useAiStore((s) => s.close);
  return (
    <>
      <div className={styles.body} aria-busy={d.text === null && d.error === null}>
        {d.error !== null ? (
          <div role="alert" className={styles.error}>
            {d.error}
          </div>
        ) : d.text === null ? (
          <span className={styles.muted}>ИИ анализирует метод…</span>
        ) : (
          <div data-testid="ai-explanation">{renderMarkdown(d.text)}</div>
        )}
      </div>
      <footer className={styles.foot}>
        <button type="button" className={styles.btn} onClick={close}>
          Закрыть
        </button>
      </footer>
    </>
  );
}

function EditBody({ d }: { d: EditDialog }) {
  const { propose, apply, close } = useAiStore();
  const [instruction, setInstruction] = useState('');
  const diff = useMemo(() => parseUnifiedDiff(d.proposal?.diff), [d.proposal?.diff]);
  const showDiff = d.stage === 'diff' || d.stage === 'applying';
  const busy = d.stage === 'loading' || d.stage === 'applying';
  return (
    <>
      <div className={styles.body}>
        <label className={styles.label}>
          Что изменить
          <textarea
            className={styles.input}
            value={instruction}
            rows={2}
            placeholder="Например: добавь проверку на null"
            disabled={d.stage !== 'input'}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </label>
        {d.stage === 'loading' && <span className={styles.muted}>ИИ готовит правку…</span>}
        {showDiff && (
          <>
            <div className={styles.muted}>
              Предложение ИИ — ничего не применено. Правка намеренно меняет поведение, Quality Gate её не проверяет.
            </div>
            <div className={styles.diff} data-testid="ai-diff">
              {diff.lines.map((l, i) => (
                <span key={i} className={`${styles.dl} ${styles[l.kind] ?? ''}`} data-kind={l.kind}>
                  <span className={styles.sg}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
                  {l.text}
                </span>
              ))}
            </div>
          </>
        )}
        {d.error !== null && (
          <div role="alert" className={styles.error}>
            {d.error}
          </div>
        )}
      </div>
      <footer className={styles.foot}>
        {showDiff ? (
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={busy} onClick={() => void apply()}>
            Применить
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            disabled={busy || instruction.trim() === ''}
            onClick={() => void propose(instruction)}
          >
            Предложить правку
          </button>
        )}
        <button type="button" className={styles.btn} disabled={d.stage === 'applying'} onClick={close}>
          Отмена
        </button>
      </footer>
    </>
  );
}
