import { useEffect } from 'react';
import { create } from 'zustand';
import type { ApiClient, Schemas, paths } from '../api';
import { useTestsStore } from '../tests-panel';
import { useAppStore } from '../../app/store';

type ApiError = Schemas['Error'];
type RunBody = NonNullable<paths['/projects/{projectId}/run']['post']['requestBody']>['content']['application/json'];

/** Интервал повторной проверки /health, пока песочница недоступна. */
export const HEALTH_RETRY_MS = 15_000;

/** Что сейчас выполняется в песочнице. */
export type SandboxBusy = 'run' | 'verify' | null;

export interface SandboxNotice {
  kind: 'error' | 'warning';
  title: string;
  text: string;
  /** Растёт на каждое сообщение — тост показывается заново. */
  seq: number;
}

export interface RunDialogState {
  /** Ошибка последней попытки (422 INVALID_REQUEST / AMBIGUOUS_MAIN и т.п.). */
  error: string | null;
  /** Точки входа из 422 AMBIGUOUS_MAIN (details.mainClasses), если пришли. */
  mainClasses: string[] | null;
}

interface SandboxState {
  client: ApiClient | null;
  projectId: string | null;
  /** GET /health → docker; null — неизвестно (health не ответил), кнопки не блокируются. */
  docker: boolean | null;
  /** 503 SandboxUnavailable (Error.message); кнопки неактивны, пока health не покажет docker. */
  unavailable: string | null;
  /** Project.mainClasses (GET /projects/{id}); null — ещё не загружены. */
  mainClasses: string[] | null;
  busy: SandboxBusy;
  /** Открыт диалог «Запуск» (выбор точки входа и stdin). */
  runDialog: RunDialogState | null;
  /** Последние параметры запуска — подставляются в диалог. */
  lastMainClass: string | null;
  lastStdin: string;
  notice: SandboxNotice | null;

  /** Привязать к проекту: GET /health и GET /projects/{id} (mainClasses). */
  init: (client: ApiClient, projectId: string) => Promise<void>;
  checkHealth: () => Promise<void>;
  openRun: () => void;
  closeRun: () => void;
  /** POST run. Успех → «Последний запуск» в панели тестов. */
  run: (mainClass: string | null, stdin: string) => Promise<void>;
  /** POST verify. Успех → итог проверки в панели тестов. */
  verify: () => Promise<void>;
  dismissNotice: () => void;
}

const initial = {
  client: null,
  projectId: null,
  docker: null,
  unavailable: null,
  mainClasses: null,
  busy: null as SandboxBusy,
  runDialog: null,
  lastMainClass: null,
  lastStdin: '',
  notice: null,
};

const TESTS_PANEL = { area: 'bottom', id: 'bottom.tests' } as const;
const CONSOLE_PANEL = { area: 'bottom', id: 'bottom.console' } as const;

let noticeSeq = 0;

function notice(kind: SandboxNotice['kind'], title: string, text: string): SandboxNotice {
  noticeSeq += 1;
  return { kind, title, text, seq: noticeSeq };
}

/** details.mainClasses из 422 AMBIGUOUS_MAIN (строки), иначе пусто. */
export function ambiguousMainClasses(error: ApiError | undefined): string[] {
  const raw = error?.details?.mainClasses;
  return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string') : [];
}

function showTestsPanel(): void {
  useAppStore.getState().showPanel(TESTS_PANEL.area, TESTS_PANEL.id);
}

function showConsolePanel(): void {
  useAppStore.getState().showPanel(CONSOLE_PANEL.area, CONSOLE_PANEL.id);
}

function failureText(status: number | null, error: ApiError | undefined): string {
  if (status === null) return 'Сервер недоступен — попробуйте снова.';
  if (status === 404) return 'Проект не найден на сервере — загрузите его заново.';
  return error?.message ?? `HTTP ${status}`;
}

/**
 * Запуск и проверка поведения (ТЗ §10, §11а): состояние песочницы (Docker из /health, 503),
 * диалог запуска и выполняющийся прогон. Вне React — `useSandboxStore.getState()` (команды `commands.ts`).
 */
export const useSandboxStore = create<SandboxState>()((set, get) => ({
  ...initial,

  init: async (client, projectId) => {
    const sameProject = get().projectId === projectId;
    set(sameProject ? { client } : { ...initial, client, projectId });
    await Promise.all([
      get().checkHealth(),
      client
        .GET('/projects/{projectId}', { params: { path: { projectId } } })
        .then(({ data }) => {
          if (data && get().projectId === projectId) set({ mainClasses: data.mainClasses ?? [] });
        })
        .catch(() => {
          // Без списка main — запуск без mainClass, бэк сам ответит 422 AMBIGUOUS_MAIN.
        }),
    ]);
  },

  checkHealth: async () => {
    const { client } = get();
    if (!client) return;
    try {
      const { data } = await client.GET('/health');
      if (!data) return;
      set(data.docker ? { docker: true, unavailable: null } : { docker: false });
    } catch {
      // health не ответил — не блокируем кнопки, ошибку покажет сам запуск.
    }
  },

  openRun: () => set({ runDialog: { error: null, mainClasses: null } }),
  closeRun: () => set({ runDialog: null }),

  run: async (mainClass, stdin) => {
    const { client, projectId, busy } = get();
    if (!client || !projectId || busy) return;
    set({ busy: 'run', lastMainClass: mainClass, lastStdin: stdin });
    const body: RunBody = { stdin };
    if (mainClass) body.mainClass = mainClass;
    try {
      const { data, error, response } = await client.POST('/projects/{projectId}/run', {
        params: { path: { projectId } },
        body,
      });
      if (data) {
        set({ busy: null, runDialog: null });
        useTestsStore.getState().showRunResult(data);
        showConsolePanel();
        return;
      }
      const status = response.status;
      if (status === 422) {
        const err = error as ApiError | undefined;
        const list = err?.code === 'AMBIGUOUS_MAIN' ? ambiguousMainClasses(err) : [];
        set((s) => ({
          busy: null,
          ...(list.length > 0 ? { mainClasses: list } : {}),
          runDialog: {
            error:
              err?.code === 'AMBIGUOUS_MAIN'
                ? 'Несколько классов с main — выберите точку входа.'
                : (err?.message ?? 'Запуск невозможен: точка входа не найдена.'),
            mainClasses: list.length > 0 ? list : (s.runDialog?.mainClasses ?? null),
          },
        }));
        return;
      }
      if (status === 503) {
        const reason = (error as ApiError | undefined)?.message ?? 'контейнер не стартовал';
        set({ busy: null, runDialog: null, unavailable: reason, notice: notice('error', 'Песочница недоступна', reason) });
        return;
      }
      set({ busy: null, runDialog: null, notice: notice('error', 'Запуск не удался', failureText(status, error as ApiError)) });
    } catch (e: unknown) {
      set({
        busy: null,
        runDialog: null,
        notice: notice('error', 'Запуск не удался', e instanceof Error ? e.message : failureText(null, undefined)),
      });
    }
  },

  verify: async () => {
    const { client, projectId, busy } = get();
    if (!client || !projectId || busy) return;
    set({ busy: 'verify' });
    try {
      const { data, error, response } = await client.POST('/projects/{projectId}/verify', {
        params: { path: { projectId } },
      });
      if (data) {
        set({ busy: null });
        useTestsStore.getState().showVerifyResult(data);
        showTestsPanel();
        return;
      }
      const err = error as ApiError | undefined;
      const status = response.status;
      if (status === 503) {
        const reason = err?.message ?? 'контейнер не стартовал';
        set({ busy: null, unavailable: reason, notice: notice('error', 'Песочница недоступна', reason) });
        return;
      }
      if (status === 422) {
        const list = ambiguousMainClasses(err);
        const text =
          err?.code === 'AMBIGUOUS_MAIN'
            ? `Несколько классов с main — IO-тесты не знают, что запускать${list.length ? `: ${list.join(', ')}` : ''}. Оставьте один main.`
            : (err?.message ?? 'В проекте нет класса с main — IO-тесты запустить нельзя.');
        set({ busy: null, notice: notice('warning', 'Проверка невозможна', text) });
        return;
      }
      set({ busy: null, notice: notice('error', 'Проверка не удалась', failureText(status, err)) });
    } catch (e: unknown) {
      set({
        busy: null,
        notice: notice('error', 'Проверка не удалась', e instanceof Error ? e.message : failureText(null, undefined)),
      });
    }
  },

  dismissNotice: () => set({ notice: null }),
}));

/** Почему запуск/проверка/фикс недоступны: нет проекта, нет Docker, 503. null — доступны. */
export function sandboxDisabledReason(s: Pick<SandboxState, 'projectId' | 'docker' | 'unavailable'>): string | null {
  if (!s.projectId) return 'Проект не открыт';
  if (s.unavailable) return `Песочница недоступна: ${s.unavailable}`;
  if (s.docker === false) return 'Песочница недоступна: Docker не запущен на сервере';
  return null;
}

/**
 * Хук экрана редактора: привязывает стор песочницы к проекту и клиенту; пока песочница недоступна
 * (503 или docker=false), каждые `HEALTH_RETRY_MS` повторяет GET /health. Опрос останавливается,
 * когда health снова показал Docker, и при размонтировании.
 */
export function useSandbox(client: ApiClient, projectId: string): void {
  const init = useSandboxStore((s) => s.init);
  const checkHealth = useSandboxStore((s) => s.checkHealth);
  const down = useSandboxStore((s) => s.unavailable !== null || s.docker === false);
  useEffect(() => {
    void init(client, projectId);
  }, [client, projectId, init]);
  useEffect(() => {
    if (!down) return;
    const timer = setInterval(() => void checkHealth(), HEALTH_RETRY_MS);
    return () => clearInterval(timer);
  }, [down, checkHealth]);
}

/** Сброс (тесты). */
export function resetSandboxState(): void {
  useSandboxStore.setState({ ...initial });
}
