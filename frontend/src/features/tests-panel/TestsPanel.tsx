import { useEffect } from 'react';
import { api, type ApiClient, type Schemas } from '../api';
import { useAppStore } from '../../app/store';
import { RunOutput, StatusDot, TestResultView, VerifySummary } from './ResultView';
import { IoTestForm, JUnitTestForm } from './TestForm';
import { aggregateStatus, draftText, newTest, orphanResults, resultsFor, STATUS_TEXT } from './results';
import { useTests, useTestsStore, type TestSelection, type TestsConflict } from './testsStore';
import styles from './TestsPanel.module.css';

type TestCase = Schemas['TestCase'];
type TestResult = Schemas['TestResult'];

const TOAST_MS = 6000;

function conflictText(c: TestsConflict): string {
  const versions =
    c.clientVersion !== undefined && c.serverVersion !== undefined
      ? `Ваша правка относилась к версии ${c.clientVersion}, сейчас ${c.serverVersion}. `
      : '';
  const lost = c.draft ? ' Ваша правка не сохранена.' : '';
  return `${versions}Состояние перезагружено.${lost}`;
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

function isSelected(sel: TestSelection | null, kind: 'test' | 'result', t: { type: string; name: string }): boolean {
  return sel?.kind === kind && sel.type === t.type && sel.name === t.name;
}

function TestItem({
  test,
  results,
  selected,
  onClick,
}: {
  test: TestCase;
  results: TestResult[];
  selected: boolean;
  onClick: () => void;
}) {
  const status = aggregateStatus(results);
  const noisy = results.reduce((n, r) => n + (r.noisyLines?.length ?? 0), 0);
  let badge: string;
  if (test.type === 'junit') {
    const passed = results.filter((r) => r.status === 'passed').length;
    badge = status === 'compile_error' ? STATUS_TEXT.compile_error : results.length ? `${passed} / ${results.length}` : '';
  } else {
    badge = noisy > 0 ? `${noisy} шум` : test.mode === 'manual' ? 'ручной' : 'оригинал';
  }
  return (
    <button
      type="button"
      className={selected ? `${styles.item} ${styles.itemOn}` : styles.item}
      aria-pressed={selected}
      onClick={onClick}
    >
      <StatusDot status={status} />
      <span className={styles.itemName}>{test.name}</span>
      {badge && (
        <span className={styles.badge} data-status={status ?? 'none'}>
          {badge}
        </span>
      )}
    </button>
  );
}

function TestList({ tests, results }: { tests: TestCase[]; results: TestResult[] }) {
  const selected = useTestsStore((s) => s.selected);
  const run = useTestsStore((s) => s.run);
  const runUnseen = useTestsStore((s) => s.runUnseen);
  const select = useTestsStore((s) => s.select);
  const io = tests.filter((t) => t.type === 'io');
  const junit = tests.filter((t) => t.type === 'junit');
  const orphans = orphanResults(tests, results);

  return (
    <nav className={styles.list} aria-label="Тесты проекта">
      {run && (
        <button
          type="button"
          className={selected?.kind === 'run' ? `${styles.item} ${styles.itemOn}` : styles.item}
          aria-pressed={selected?.kind === 'run'}
          onClick={() => select({ kind: 'run' })}
        >
          <span className={styles.itemName}>Последний запуск</span>
          {runUnseen && <span className={styles.badgeNew}>новый</span>}
          <span className={styles.badge}>exit {run.exitCode}</span>
        </button>
      )}
      <div className={styles.group}>IO-тесты · {io.length}</div>
      {io.map((t) => (
        <TestItem
          key={`io:${t.name}`}
          test={t}
          results={resultsFor(t, results)}
          selected={isSelected(selected, 'test', t)}
          onClick={() => select({ kind: 'test', type: 'io', name: t.name })}
        />
      ))}
      <div className={styles.group}>JUnit · {junit.length}</div>
      {junit.map((t) => (
        <TestItem
          key={`junit:${t.name}`}
          test={t}
          results={resultsFor(t, results)}
          selected={isSelected(selected, 'test', t)}
          onClick={() => select({ kind: 'test', type: 'junit', name: t.name })}
        />
      ))}
      {orphans.length > 0 && <div className={styles.group}>Только результаты · {orphans.length}</div>}
      {orphans.map((r) => (
        <button
          key={`r:${r.type}:${r.name}`}
          type="button"
          className={isSelected(selected, 'result', r) ? `${styles.item} ${styles.itemOn}` : styles.item}
          aria-pressed={isSelected(selected, 'result', r)}
          onClick={() => select({ kind: 'result', type: r.type, name: r.name })}
        >
          <StatusDot status={r.status} />
          <span className={styles.itemName}>{r.name}</span>
        </button>
      ))}
      <div className={styles.listActions}>
        <button type="button" className={styles.btn} onClick={() => select({ kind: 'new', type: 'io' })}>
          + IO-тест
        </button>
        <button type="button" className={styles.btn} onClick={() => select({ kind: 'new', type: 'junit' })}>
          + JUnit-класс
        </button>
      </div>
    </nav>
  );
}

function Detail({ client, projectId, tests, results }: { client: ApiClient; projectId: string; tests: TestCase[]; results: TestResult[] }) {
  const selected = useTestsStore((s) => s.selected);
  const saving = useTestsStore((s) => s.saving);
  const saveError = useTestsStore((s) => s.saveError);
  const reloadSeq = useTestsStore((s) => s.reloadSeq);
  const run = useTestsStore((s) => s.run);
  const restored = useTestsStore((s) => s.restored);
  const setDirty = useTestsStore((s) => s.setDirty);
  const { save, remove, select } = useTestsStore.getState();

  if (!selected) return <div className={styles.empty}>Выберите тест слева или создайте новый.</div>;

  if (selected.kind === 'run') return run ? <RunOutput run={run} /> : null;

  if (selected.kind === 'result') {
    const r = results.find((x) => x.type === selected.type && x.name === selected.name);
    return r ? <TestResultView result={r} /> : null;
  }

  const isNew = selected.kind === 'new';
  const test = isNew
    ? newTest(selected.type, tests.map((t) => t.name))
    : tests.find((t) => t.type === selected.type && t.name === selected.name);
  if (!test) return null;
  const own = isNew ? [] : resultsFor(test, results);
  const draft =
    restored && restored.isNew === isNew && restored.test.type === test.type && (isNew || restored.test.name === test.name)
      ? restored.test
      : undefined;
  const Form = test.type === 'io' ? IoTestForm : JUnitTestForm;

  return (
    <div className={styles.detail}>
      {own.map((r) => (
        <TestResultView key={r.name} result={r} ignoreLines={test.ignoreLines} />
      ))}
      <Form
        key={`${selected.kind}:${test.type}:${test.name}:${reloadSeq}`}
        test={test}
        draft={draft}
        onDirtyChange={setDirty}
        isNew={isNew}
        saving={saving}
        error={saveError}
        onSave={(t) => void save(client, projectId, t, isNew)}
        onDelete={isNew ? undefined : () => void remove(client, projectId, test)}
        onCancel={() => select(null)}
      />
    </div>
  );
}

export interface TestsPanelProps {
  client?: ApiClient;
}

/**
 * Вкладка «Тесты» нижней панели (ТЗ §10): список IO- и JUnit-тестов, правка, результаты проверки.
 * Результаты приходят извне: `useTestsStore.getState().showVerifyResult(...)` / `showRunResult(...)`.
 */
export function TestsPanel({ client = api }: TestsPanelProps) {
  const projectId = useTests(client);
  const status = useTestsStore((s) => s.status);
  const error = useTestsStore((s) => s.error);
  const tests = useTestsStore((s) => s.tests);
  const verify = useTestsStore((s) => s.verify);
  const resultsVersion = useTestsStore((s) => s.resultsVersion);
  const conflict = useTestsStore((s) => s.conflict);
  const dismissConflict = useTestsStore((s) => s.dismissConflict);
  const select = useTestsStore((s) => s.select);
  const restoreDraft = useTestsStore((s) => s.restoreDraft);
  const version = useAppStore((s) => s.version);

  useEffect(() => {
    // С отброшенной правкой тост висит, пока его не закроют: иначе текст правки пропадёт.
    if (!conflict || conflict.draft) return;
    const t = setTimeout(dismissConflict, TOAST_MS);
    return () => clearTimeout(t);
    // Перезапуск таймера на каждый новый 409.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflict?.seq]);

  if (!projectId) return <div className={styles.empty}>Проект не открыт.</div>;

  const lostDraft = conflict?.draft;
  const results = verify?.results ?? [];
  const stale = verify && resultsVersion !== null && version !== null && resultsVersion !== version ? resultsVersion : null;

  return (
    <section className={styles.root} aria-label="Тесты">
      {verify && (
        <VerifySummary verify={verify} staleVersion={stale} onCreateStub={() => select({ kind: 'new', type: 'io' })} />
      )}
      {status === 'error' && (
        <div className={styles.errorText} role="alert">
          Не удалось загрузить тесты: {error}
        </div>
      )}
      <div className={styles.columns}>
        {status === 'loading' && tests.length === 0 ? (
          <div className={styles.empty}>Загрузка тестов…</div>
        ) : (
          <TestList tests={tests} results={results} />
        )}
        <div className={styles.main}>
          <Detail client={client} projectId={projectId} tests={tests} results={results} />
        </div>
      </div>

      {conflict && (
        <div className={styles.toast} role="alert" key={conflict.seq}>
          <span className={styles.toastIcon} aria-hidden="true">
            !
          </span>
          <div className={styles.toastBody}>
            <span className={styles.toastTitle}>Проект изменён</span>
            <span className={styles.toastText}>{conflictText(conflict)}</span>
            {lostDraft && (
              <>
                <div className={styles.toastActions}>
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={restoreDraft}>
                    Повторить с моей правкой
                  </button>
                  <button type="button" className={styles.btn} onClick={() => copyText(draftText(lostDraft.test))}>
                    Скопировать
                  </button>
                </div>
                <details className={styles.toastDraft}>
                  <summary>Текст правки</summary>
                  <textarea
                    className={styles.textarea}
                    aria-label="Текст несохранённой правки"
                    readOnly
                    rows={5}
                    value={draftText(lostDraft.test)}
                  />
                </details>
              </>
            )}
          </div>
          <button type="button" className={styles.toastClose} onClick={dismissConflict} aria-label="Закрыть">
            ×
          </button>
        </div>
      )}
    </section>
  );
}
