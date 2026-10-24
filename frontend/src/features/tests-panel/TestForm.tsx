import { Suspense, lazy, useEffect, useState } from 'react';
import type { Schemas } from '../api';
import { parseLineList } from './results';
import styles from './TestsPanel.module.css';

type TestCase = Schemas['TestCase'];

// Monaco тяжёлый — отдельный чанк при первом открытии JUnit-теста.
const JUnitSourceEditor = lazy(() => import('./JUnitSourceEditor'));

export interface TestFormProps {
  /** Тест с сервера или заготовка нового: с ним сравнивается форма (есть ли правки). */
  test: TestCase;
  /** Начальные значения вместо `test` — черновик, возвращённый после 409. */
  draft?: TestCase;
  /** Есть ли в форме несохранённые правки (для панели: не переключать выбор). */
  onDirtyChange?: (dirty: boolean) => void;
  isNew: boolean;
  saving: boolean;
  error: string | null;
  onSave: (test: TestCase) => void;
  onDelete?: () => void;
  onCancel?: () => void;
}

function sameTestContent(a: TestCase, b: TestCase): boolean {
  if (a.name !== b.name || a.type !== b.type) return false;
  if (a.type === 'junit') return (a.source ?? '') === (b.source ?? '');
  const mode = a.mode ?? 'original';
  return (
    (a.stdin ?? '') === (b.stdin ?? '') &&
    mode === (b.mode ?? 'original') &&
    (mode !== 'manual' || (a.expected ?? '') === (b.expected ?? '')) &&
    (a.ignoreLines ?? []).join(',') === (b.ignoreLines ?? []).join(',')
  );
}

/** Сообщает панели, отличается ли текущее содержимое формы от `test`. */
function useDirty(current: TestCase, test: TestCase, onDirtyChange?: (dirty: boolean) => void) {
  const dirty = !sameTestContent(current, test);
  useEffect(() => {
    onDirtyChange?.(dirty);
    // Форма закрыта (или пересоздаётся) — её правок больше нет.
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
}

function Actions({ isNew, saving, onDelete, onCancel }: Pick<TestFormProps, 'isNew' | 'saving' | 'onDelete' | 'onCancel'>) {
  return (
    <div className={styles.actions}>
      <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
        {saving ? 'Сохранение…' : isNew ? 'Создать' : 'Сохранить'}
      </button>
      {isNew
        ? onCancel && (
            <button type="button" className={styles.btn} onClick={onCancel} disabled={saving}>
              Отмена
            </button>
          )
        : onDelete && (
            <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={onDelete} disabled={saving}>
              Удалить
            </button>
          )}
    </div>
  );
}

function NameField({ value, isNew, onChange }: { value: string; isNew: boolean; onChange: (v: string) => void }) {
  return (
    <label className={styles.field}>
      Имя
      <input
        className={styles.input}
        type="text"
        value={value}
        readOnly={!isNew}
        title={isNew ? undefined : 'Имя задаёт файл теста; чтобы переименовать — создайте новый тест'}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** Форма IO-теста: имя, stdin, режим ожидаемого вывода, игнорируемые строки. */
export function IoTestForm({ test, draft, isNew, saving, error, onSave, onDelete, onCancel, onDirtyChange }: TestFormProps) {
  const init = draft ?? test;
  const [name, setName] = useState(init.name);
  const [stdin, setStdin] = useState(init.stdin ?? '');
  const [mode, setMode] = useState<'original' | 'manual'>(init.mode ?? 'original');
  const [expected, setExpected] = useState(init.expected ?? '');
  const [ignore, setIgnore] = useState((init.ignoreLines ?? []).join(', '));
  const current: TestCase = {
    name,
    type: 'io',
    stdin,
    mode,
    expected: mode === 'manual' ? expected : null,
    ignoreLines: parseLineList(ignore),
  };
  useDirty(current, test, onDirtyChange);

  return (
    <form
      className={styles.form}
      aria-label={`IO-тест ${test.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(current);
      }}
    >
      <div className={styles.formHead}>Тест · tests/{test.name || '…'}.json</div>
      <div className={styles.formBody}>
        <NameField value={name} isNew={isNew} onChange={setName} />
        <div className={styles.field}>
          <span>Ожидаемый вывод</span>
          <div className={styles.seg} role="group" aria-label="Режим">
            <button
              type="button"
              className={mode === 'original' ? styles.segOn : undefined}
              aria-pressed={mode === 'original'}
              onClick={() => setMode('original')}
            >
              Как у оригинала
            </button>
            <button
              type="button"
              className={mode === 'manual' ? styles.segOn : undefined}
              aria-pressed={mode === 'manual'}
              onClick={() => setMode('manual')}
            >
              Задать вручную
            </button>
          </div>
        </div>
        <label className={`${styles.field} ${styles.wide}`}>
          stdin
          <textarea className={styles.textarea} rows={4} value={stdin} onChange={(e) => setStdin(e.target.value)} />
        </label>
        {mode === 'manual' && (
          <label className={`${styles.field} ${styles.wide}`}>
            Ожидаемый stdout
            <textarea
              className={styles.textarea}
              rows={4}
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
          </label>
        )}
        <label className={styles.field}>
          Игнорируемые строки вывода
          <input
            className={styles.input}
            type="text"
            placeholder="напр. 6, 7"
            value={ignore}
            onChange={(e) => setIgnore(e.target.value)}
          />
        </label>
        {error && (
          <div className={`${styles.errorText} ${styles.wide}`} role="alert">
            {error}
          </div>
        )}
        <Actions isNew={isNew} saving={saving} onDelete={onDelete} onCancel={onCancel} />
      </div>
    </form>
  );
}

/** Форма JUnit-теста: имя класса и текст tests/*.java в Monaco. */
export function JUnitTestForm({ test, draft, isNew, saving, error, onSave, onDelete, onCancel, onDirtyChange }: TestFormProps) {
  const init = draft ?? test;
  const [name, setName] = useState(init.name);
  const [source, setSource] = useState(init.source ?? '');
  useDirty({ name, type: 'junit', source }, test, onDirtyChange);

  return (
    <form
      className={styles.form}
      aria-label={`JUnit-тест ${test.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, type: 'junit', source });
      }}
    >
      <div className={styles.formHead}>tests/{test.name || '…'}.java</div>
      <div className={styles.formBody}>
        <NameField value={name} isNew={isNew} onChange={setName} />
        <div className={`${styles.monaco} ${styles.wide}`}>
          <Suspense fallback={<div className={styles.muted}>Загрузка редактора…</div>}>
            <JUnitSourceEditor value={source} onChange={setSource} />
          </Suspense>
        </div>
        <span className={`${styles.muted} ${styles.wide}`}>
          private-члены видны тестам: при сборке тестов они становятся package-private. Ваш код не меняется.
        </span>
        {error && (
          <div className={`${styles.errorText} ${styles.wide}`} role="alert">
            {error}
          </div>
        )}
        <Actions isNew={isNew} saving={saving} onDelete={onDelete} onCancel={onCancel} />
      </div>
    </form>
  );
}
