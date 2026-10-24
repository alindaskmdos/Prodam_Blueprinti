import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import type { ApiClient, Schemas } from '../api';
import { formatSize, fromDataTransfer, fromFileList, type UploadItem } from './collectFiles';
import { describeUploadError, UPLOAD_STEPS, warningBadge, type UploadFailure } from './messages';
import { uploadProject } from './projectApi';
import styles from './Upload.module.css';

interface UploadScreenProps {
  client: ApiClient;
  /** Проект загружен: открыть его в редакторе. */
  onOpen: (project: Schemas['Project']) => void;
  /** Вернуться к уже открытому проекту (кнопка видна, только если передан). */
  onCancel?: () => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'done'; project: Schemas['Project'] }
  | { kind: 'failed'; failure: UploadFailure };

interface Selection {
  label: string;
  count: number;
  size: number;
}

/** Экран загрузки (docs/design/screens/Upload.dc.html, ТЗ §11): drop / файлы / папка → POST /projects. */
export function UploadScreen({ client, onOpen, onCancel }: UploadScreenProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const request = useRef(0);

  useEffect(() => {
    // webkitdirectory нет в типах React — ставим атрибутом.
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  async function upload(items: UploadItem[]) {
    if (items.length === 0) return;
    const id = ++request.current;
    setSelection(describeSelection(items));
    setPhase({ kind: 'uploading' });
    const result = await uploadProject(client, items);
    if (id !== request.current) return;
    if (!result.ok) {
      setPhase({ kind: 'failed', failure: describeUploadError(result.status, result.error) });
      return;
    }
    if (result.project.warnings.length === 0) onOpen(result.project);
    else setPhase({ kind: 'done', project: result.project });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void fromDataTransfer(e.dataTransfer).then(upload);
  }

  const busy = phase.kind === 'uploading';

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
              <path d="M10 6.5h4a2.5 2.5 0 0 1 2.5 2.5v5" />
            </svg>
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>Java Blueprints</span>
            <span className={styles.muted}>{onCancel ? 'загрузка нового проекта' : 'проект не загружен'}</span>
          </div>
        </div>
        <div className={styles.spacer} />
        {onCancel && (
          <button type="button" className={styles.btn} onClick={onCancel}>
            ← К проекту
          </button>
        )}
      </header>

      <main className={styles.main}>
        <div className={styles.content}>
          <div className={`${styles.intro} jb-rise`}>
            <span className={styles.eyebrow}>Шаг 1 из 6 · загрузить</span>
            <h1 className={styles.title}>Загрузите Java-проект — увидите его как схему</h1>
            <p className={styles.lead}>
              Монолит до ~1000 строк. Источник правды — ваш код: схема строится из него, а неизменённые методы
              сохраняются байт в байт.
            </p>
          </div>

          <div className={styles.row}>
            <section
              className={`${styles.drop} ${dragging ? styles.dropActive : ''} jb-rise`}
              style={rise(1)}
              data-testid="drop-zone"
              aria-busy={busy}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <svg className={styles.dropBorder} aria-hidden="true">
                <rect x="1" y="1" width="99.6%" height="99.4%" rx="15" ry="15" />
              </svg>
              <div className={styles.dropIcon} aria-hidden="true">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 16V4" />
                  <path d="m7 9 5-5 5 5" />
                  <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                </svg>
              </div>
              <div className={styles.dropText}>
                <span className={styles.dropTitle}>Перетащите файлы сюда</span>
                <span className={styles.muted14}>.java, .zip, .jar с исходниками или папку целиком</span>
              </div>
              <div className={styles.pick}>
                <label className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLarge}`}>
                  Выбрать файлы
                  <input
                    type="file"
                    multiple
                    accept=".java,.zip,.jar"
                    className={styles.hiddenInput}
                    aria-label="Выбрать файлы"
                    disabled={busy}
                    onChange={(e) => {
                      const files = e.currentTarget.files;
                      void upload(files ? fromFileList(files) : []);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                <label className={`${styles.btn} ${styles.btnLarge}`}>
                  Выбрать папку
                  <input
                    ref={folderInput}
                    type="file"
                    multiple
                    className={styles.hiddenInput}
                    aria-label="Выбрать папку"
                    disabled={busy}
                    onChange={(e) => {
                      const files = e.currentTarget.files;
                      void upload(files ? fromFileList(files) : []);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
              </div>
              <div className={styles.chips}>
                <span className={styles.chip}>.java</span>
                <span className={styles.chip}>.zip</span>
                <span className={styles.chip}>.jar · *-sources</span>
                <span className={styles.chip}>папка + tests/</span>
              </div>
              <span className={styles.limits}>До 20 МБ и 2000 файлов. pom.xml, build.gradle и .class игнорируются.</span>
            </section>

            <ProgressPanel phase={phase} selection={selection} onOpen={onOpen} />
          </div>

          <section className={`${styles.failures} jb-rise`} style={rise(3)}>
            <span className={styles.sectionTitle}>Когда загрузка не пройдёт</span>
            <div className={styles.failGrid}>
              <div className={styles.failCard}>
                <span className={styles.failTitle}>Нужны исходники</span>
                <span className={styles.failText}>В .jar только .class. Загрузите *-sources.jar или папку с .java.</span>
              </div>
              <div className={styles.failCard}>
                <span className={styles.failTitle}>Дубликат класса</span>
                <span className={styles.failText}>Класс с одним полным именем объявлен в двух файлах.</span>
              </div>
              <div className={styles.failCard}>
                <span className={styles.failTitle}>Небезопасный архив</span>
                <span className={styles.failText}>Путь с «..» или больше 20 МБ при распаковке. Архив отклонён целиком.</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function ProgressPanel({
  phase,
  selection,
  onOpen,
}: {
  phase: Phase;
  selection: Selection | null;
  onOpen: (project: Schemas['Project']) => void;
}) {
  if (phase.kind === 'idle' || !selection) {
    return (
      <section className={`${styles.panel} jb-rise`} style={rise(2)}>
        <div className={styles.panelHeader}>Разбор проекта</div>
        <p className={styles.placeholder}>Выберите файлы, архив или папку — здесь появятся шаги разбора и предупреждения.</p>
      </section>
    );
  }

  return (
    <section
      className={`${styles.panel} jb-rise`}
      style={rise(2)}
      aria-label="Разбор проекта"
      aria-live="polite"
    >
      <div className={styles.panelHeader}>
        <span className={styles.selectionName}>{selection.label}</span>
        <span className={styles.badgeInfo}>{formatSize(selection.size)}</span>
      </div>
      <ol className={styles.steps}>
        {UPLOAD_STEPS.map((title, i) => (
          <Step key={title} title={title} state={stepState(phase, i)} detail={stepDetail(phase, selection, i)} />
        ))}
      </ol>

      {phase.kind === 'failed' && <FailureMessage failure={phase.failure} />}

      {phase.kind === 'done' && (
        <>
          <ul className={styles.messages} aria-label="Предупреждения загрузки">
            {phase.project.warnings.map((w, i) => (
              <WarningRow key={`${w.code}-${w.file ?? ''}-${i}`} warning={w} index={i} />
            ))}
          </ul>
          <div className={styles.panelFooter}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnWide}`}
              onClick={() => onOpen(phase.project)}
            >
              Открыть проект →
            </button>
          </div>
        </>
      )}
    </section>
  );
}

type StepState = 'done' | 'active' | 'failed' | 'waiting';

function stepState(phase: Phase, i: number): StepState {
  switch (phase.kind) {
    case 'uploading':
      return i === 0 ? 'active' : 'waiting';
    case 'done':
      return 'done';
    case 'failed':
      if (i < phase.failure.failedStep) return 'done';
      return i === phase.failure.failedStep ? 'failed' : 'waiting';
    default:
      return 'waiting';
  }
}

function stepDetail(phase: Phase, selection: Selection, i: number): string | null {
  if (i === 0) return `${selection.count} ${plural(selection.count, 'файл', 'файла', 'файлов')}`;
  if (i === 3 && phase.kind === 'done') {
    const n = phase.project.files.length;
    return `${n} ${plural(n, 'файл', 'файла', 'файлов')} .java`;
  }
  return null;
}

const STEP_LABEL: Record<StepState, string> = {
  done: 'готово',
  active: 'выполняется',
  failed: 'ошибка',
  waiting: 'ожидает',
};

function Step({ title, state, detail }: { title: string; state: StepState; detail: string | null }) {
  return (
    <li className={styles.step} data-state={state}>
      <span className={`${styles.dot} ${styles[`dot_${state}`]}`} aria-label={STEP_LABEL[state]}>
        {state === 'done' ? '✓' : state === 'failed' ? '✕' : ''}
      </span>
      {title}
      {detail && <span className={styles.stepDetail}>{detail}</span>}
    </li>
  );
}

function FailureMessage({ failure }: { failure: UploadFailure }) {
  return (
    <div className={`${styles.failure} jb-rise`} role="alert">
      <span className={styles.failTitle}>{failure.title}</span>
      {failure.hint && <span className={styles.failText}>{failure.hint}</span>}
      {failure.message && <span className={styles.failServer}>{failure.message}</span>}
      {failure.files.length > 0 && (
        <ul className={styles.failFiles}>
          {failure.files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WarningRow({ warning, index }: { warning: Schemas['LoadWarning']; index: number }) {
  const badge = warningBadge(warning.code);
  return (
    <li className={`${styles.msg} jb-rise`} style={rise(4 + index)}>
      <span className={`${styles.badge} ${styles[`tone_${badge.tone}`]}`}>{badge.label}</span>
      <span className={styles.msgText}>
        {warning.message}
        {warning.file && <span className={styles.msgFile}>{warning.file}</span>}
      </span>
    </li>
  );
}

function describeSelection(items: UploadItem[]): Selection {
  const size = items.reduce((sum, i) => sum + i.file.size, 0);
  const first = items[0];
  let label = `${items.length} ${plural(items.length, 'файл', 'файла', 'файлов')}`;
  if (items.length === 1 && first) label = first.path;
  else {
    const tops = new Set(items.map((i) => (i.path.includes('/') ? i.path.split('/')[0] : '')));
    const [top] = tops;
    if (tops.size === 1 && top) label = `${top}/`;
  }
  return { label, count: items.length, size };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Каскад появления jb-rise: задержка i × 60 мс. */
function rise(i: number): CSSProperties {
  return { '--jb-i': i } as CSSProperties;
}
