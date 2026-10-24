import { useEffect, useState, type FormEvent } from 'react';
import { useSandboxStore } from './sandboxStore';
import styles from './Sandbox.module.css';

/** Диалог «Запуск» (ТЗ §11а): точка входа при нескольких main, stdin. Открыт, пока `runDialog` не null. */
export function RunDialog() {
  const dialog = useSandboxStore((s) => s.runDialog);
  if (!dialog) return null;
  return <RunDialogBody />;
}

function RunDialogBody() {
  const dialog = useSandboxStore((s) => s.runDialog);
  const projectMains = useSandboxStore((s) => s.mainClasses);
  const busy = useSandboxStore((s) => s.busy);
  const lastMainClass = useSandboxStore((s) => s.lastMainClass);
  const lastStdin = useSandboxStore((s) => s.lastStdin);
  const run = useSandboxStore((s) => s.run);
  const closeRun = useSandboxStore((s) => s.closeRun);

  const mains = dialog?.mainClasses ?? projectMains ?? [];
  const [mainClass, setMainClass] = useState<string | null>(null);
  const [stdin, setStdin] = useState(lastStdin);
  const running = busy === 'run';
  const pick = (c: string | null) => (c && mains.includes(c) ? c : null);
  const selected = pick(mainClass) ?? pick(lastMainClass);
  // Несколько main — пользователь выбирает явно; один — подставляется сам.
  const effectiveMain = mains.length === 1 ? mains[0] : selected;
  const needsChoice = mains.length > 1 && !effectiveMain;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !running) closeRun();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeRun, running]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (running || needsChoice) return;
    void run(effectiveMain ?? null, stdin);
  }

  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && !running && closeRun()}>
      <form role="dialog" aria-modal="true" aria-labelledby="jb-run-title" className={styles.dialog} onSubmit={submit}>
        <div className={styles.head}>
          <span id="jb-run-title" className={styles.title}>
            Запуск программы
          </span>
          <span className={styles.muted}>Одноразовый контейнер · сеть выключена · таймаут 10 с</span>
        </div>
        <div className={styles.body}>
          {mains.length > 1 && (
            <label className={styles.field}>
              <span className={styles.label}>Точка входа</span>
              <select
                className={styles.select}
                value={effectiveMain ?? ''}
                onChange={(e) => setMainClass(e.target.value || null)}
                disabled={running}
              >
                <option value="">— выберите класс с main —</option>
                {mains.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mains.length === 1 && (
            <span className={styles.muted}>
              Точка входа: <span className={styles.mono}>{mains[0]}</span>
            </span>
          )}
          <label className={styles.field}>
            <span className={styles.label}>stdin</span>
            <textarea
              className={styles.textarea}
              value={stdin}
              rows={5}
              spellCheck={false}
              placeholder="Входные данные программы (System.in)"
              onChange={(e) => setStdin(e.target.value)}
              disabled={running}
            />
          </label>
          {dialog?.error && (
            <div className={styles.error} role="alert">
              {dialog.error}
            </div>
          )}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={closeRun} disabled={running}>
            Отмена
          </button>
          <button
            type="submit"
            className={`${styles.btn} ${styles.btnOk}`}
            disabled={running || needsChoice}
            title={needsChoice ? 'Выберите точку входа' : undefined}
          >
            {running ? (
              <>
                <span className={styles.spinner} aria-hidden="true" /> Выполняется…
              </>
            ) : (
              '▶ Запустить'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
