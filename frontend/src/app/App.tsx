import { useEffect, useState } from 'react';
import { api, type ApiClient, type Schemas } from '../features/api';
import styles from './App.module.css';

/** Проект по умолчанию для заглушки (id из contract/fixtures/project.json). */
const DEMO_PROJECT_ID = 'p-1';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; tree: Schemas['ProjectTree'] };

interface AppProps {
  client?: ApiClient;
  projectId?: string;
}

/** Заглушка FE-01: проверяет связку клиент → (MSW | бэкенд). Экраны — FE-02/FE-15. */
export function App({ client = api, projectId = DEMO_PROJECT_ID }: AppProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    client
      .GET('/projects/{projectId}/tree', { params: { path: { projectId } } })
      .then(({ data, error, response }) => {
        if (cancelled) return;
        if (data) setState({ kind: 'ok', tree: data });
        else setState({ kind: 'error', message: error?.message ?? `HTTP ${response.status}` });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectId]);

  const mode = import.meta.env.VITE_USE_MOCKS === 'true' ? 'моки (contract/fixtures)' : 'бэкенд';

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>Java Blueprints</span>
        <span className={styles.mode}>режим: {mode}</span>
      </header>
      <section className={`${styles.card} jb-rise`}>
        <h1 className={styles.title}>Проект {projectId}</h1>
        {state.kind === 'loading' && <p className={styles.muted}>Загрузка дерева…</p>}
        {state.kind === 'error' && (
          <p role="alert" className={styles.error}>
            Ошибка: {state.message}
          </p>
        )}
        {state.kind === 'ok' && (
          <>
            <p className={styles.muted}>версия {state.tree.version}</p>
            <ul className={styles.list} data-testid="packages">
              {state.tree.packages.map((pkg) => (
                <li key={pkg.name}>
                  <code>{pkg.name}</code>
                  <span className={styles.muted}> · файлов: {pkg.files.length}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
