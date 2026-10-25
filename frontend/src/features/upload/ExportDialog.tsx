import { useEffect, useState } from 'react';
import type { ApiClient, Schemas } from '../api';
import { exportProject, type ExportRequest, type ExportResult } from './projectApi';
import styles from './Export.module.css';

/** Сохранить файл у пользователя. По умолчанию — ссылка с download; в тестах подменяется. */
export type SaveFile = (blob: Blob, filename: string) => void;

interface ExportDialogProps {
  client: ApiClient;
  projectId: string;
  version: number | null;
  onClose: () => void;
  save?: SaveFile;
}

/** Причина, по которой сборка .jar недоступна. */
type JarBlock = { kind: 'compile'; text: string } | { kind: 'unsupported'; text: string };

const JAR_UNSUPPORTED =
  'Сборка .jar пока не поддерживается сервером. Скачайте .zip и соберите у себя (javac + jar, Java 21+).';

/** Диалог экспорта (docs/design/screens/Export.dc.html, ТЗ §11): .zip с галочкой настроек и исполняемый .jar. */
export function ExportDialog({ client, projectId, version, onClose, save = downloadFile }: ExportDialogProps) {
  const project = useProject(client, projectId, version);
  const [includeSettings, setIncludeSettings] = useState(true);
  const [mainClass, setMainClass] = useState<string | null>(null);
  const [busy, setBusy] = useState<'zip' | 'jar' | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [jarBlock, setJarBlock] = useState<JarBlock | null>(null);
  const [jarError, setJarError] = useState<string | null>(null);

  // Новая версия проекта — причина «не компилируется» устарела.
  useEffect(() => {
    setJarBlock((b) => (b?.kind === 'compile' ? null : b));
  }, [version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mainClasses = project?.mainClasses ?? [];
  const selectedMain = mainClass ?? mainClasses[0] ?? null;
  const jarDisabledReason =
    jarBlock?.text ??
    (project && mainClasses.length === 0 ? 'В проекте нет класса с main — точку входа для .jar взять неоткуда.' : null);

  async function run(req: ExportRequest) {
    setBusy(req.format);
    if (req.format === 'zip') setZipError(null);
    else setJarError(null);
    const result = await exportProject(client, projectId, req);
    setBusy(null);
    if (result.ok) {
      save(result.blob, result.filename);
      return;
    }
    if (req.format === 'zip') {
      setZipError(failureText(result));
      return;
    }
    if (result.status === 501) setJarBlock({ kind: 'unsupported', text: JAR_UNSUPPORTED });
    else if (result.error?.code === 'COMPILE_ERROR')
      setJarBlock({ kind: 'compile', text: `Проект не компилируется: ${result.error.message}` });
    else if (result.error?.code === 'AMBIGUOUS_MAIN') setJarError(ambiguousMainText(result.error));
    else setJarError(failureText(result));
  }

  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="jb-export-title" className={styles.dialog}>
        <div className={styles.head}>
          <div className={styles.headText}>
            <span id="jb-export-title" className={styles.title}>
              Экспорт {projectId}
            </span>
          </div>
          <button type="button" className={`${styles.btn} ${styles.btnIcon}`} aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={styles.options}>
          <div className={styles.opt} style={{ animationDelay: '.15s' }}>
            <div className={styles.optHead}>
              <span className={`${styles.tag} ${styles.tagZip}`}>.zip</span>
              <span className={styles.optTitle}>Исходники</span>
            </div>
            <span className={styles.optText}>Та же структура папок, что вы загрузили.</span>
            {project && (
              <div className={styles.tree} data-testid="export-zip-files">
                {project.files.slice(0, 6).map((f) => (
                  <span key={f.path} className={styles.ft}>
                    {f.path}
                  </span>
                ))}
                {project.files.length > 6 && <span className={styles.ft}>… ещё {project.files.length - 6}</span>}
                {includeSettings && (
                  <>
                    <span className={`${styles.ft} ${styles.ftExtra}`}>tests/</span>
                    <span className={`${styles.ft} ${styles.ftExtra}`}>.blueprints/</span>
                  </>
                )}
              </div>
            )}
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={includeSettings}
                onChange={(e) => setIncludeSettings(e.currentTarget.checked)}
              />
              Включить настройки Java Blueprints — папки .blueprints/ и tests/
            </label>
            {zipError && (
              <span className={styles.error} role="alert">
                {zipError}
              </span>
            )}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBottom}`}
              disabled={busy !== null}
              onClick={() => void run({ format: 'zip', includeSettings })}
            >
              {busy === 'zip' ? 'Готовим .zip…' : 'Скачать .zip'}
            </button>
          </div>

          <div className={styles.opt} style={{ animationDelay: '.25s' }}>
            <div className={styles.optHead}>
              <span className={`${styles.tag} ${styles.tagJar}`}>.jar</span>
              <span className={styles.optTitle}>Исполняемый файл</span>
            </div>
            <span className={styles.optText}>Собирается из чистого кода: без seed, без правок видимости, без tests/.</span>
            {mainClasses.length > 0 && (
              <label className={styles.field}>
                Точка входа (Main-Class)
                <select
                  className={styles.select}
                  value={selectedMain ?? ''}
                  onChange={(e) => setMainClass(e.currentTarget.value)}
                >
                  {mainClasses.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className={styles.cmd}>java -jar {projectId}.jar</div>
            {jarDisabledReason && (
              <span className={styles.reason} role="status" data-testid="jar-reason">
                {jarDisabledReason}
              </span>
            )}
            {jarError && (
              <span className={styles.error} role="alert">
                {jarError}
              </span>
            )}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBottom}`}
              disabled={busy !== null || jarDisabledReason !== null}
              title={jarDisabledReason ?? undefined}
              onClick={() => void run({ format: 'jar', ...(selectedMain ? { mainClass: selectedMain } : {}) })}
            >
              {busy === 'jar' ? 'Собираем .jar…' : 'Собрать .jar'}
            </button>
            <span className={styles.caption}>требует Java 21+</span>
          </div>
        </div>
      </section>
    </div>
  );
}

/** AMBIGUOUS_MAIN: перечень классов с main из details.mainClasses, если бэк его прислал. */
function ambiguousMainText(error: Schemas['Error']): string {
  const raw = error.details?.mainClasses;
  const list = Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string') : [];
  const base = 'Несколько классов с main — выберите точку входа.';
  return list.length > 0 ? `${base} Найдены: ${list.join(', ')}.` : base;
}

function failureText(result: Extract<ExportResult, { ok: false }>): string {
  if (result.status === null) return 'Сервер недоступен — попробуйте снова.';
  if (result.status === 404) return 'Проект не найден на сервере — загрузите его заново.';
  return result.error?.message ?? `Экспорт не удался: HTTP ${result.status}.`;
}

/** GET /projects/{id}: файлы для превью .zip и mainClasses для выбора точки входа. */
function useProject(client: ApiClient, projectId: string, version: number | null): Schemas['Project'] | null {
  const [project, setProject] = useState<Schemas['Project'] | null>(null);
  useEffect(() => {
    let cancelled = false;
    client
      .GET('/projects/{projectId}', { params: { path: { projectId } } })
      .then(({ data }) => {
        if (!cancelled && data) setProject(data);
      })
      .catch(() => {
        // Без превью и списка main — экспорт всё равно доступен.
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectId, version]);
  return project;
}

function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
