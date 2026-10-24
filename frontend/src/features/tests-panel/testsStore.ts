import { useEffect } from 'react';
import { create } from 'zustand';
import type { ApiClient, Schemas } from '../api';
import { useAppStore } from '../../app/store';

type TestCase = Schemas['TestCase'];
type TestType = TestCase['type'];

/** Что открыто в панели: тест из списка, заготовка нового теста, результат без теста или последний запуск. */
export type TestSelection =
  | { kind: 'test'; type: TestType; name: string }
  | { kind: 'new'; type: TestType }
  | { kind: 'result'; type: TestType; name: string }
  | { kind: 'run' };

export interface TestsConflict {
  clientVersion?: number;
  serverVersion?: number;
  message: string;
  /** Растёт на каждый 409 — тост показывается заново. */
  seq: number;
  /** Несохранённая правка, отброшенная из-за 409: её можно вернуть в форму или скопировать. */
  draft?: TestDraft;
}

/** Правка теста из формы. */
export interface TestDraft {
  test: TestCase;
  isNew: boolean;
}

export type TestsStatus = 'idle' | 'loading' | 'ok' | 'error';

interface TestsState {
  projectId: string | null;
  status: TestsStatus;
  tests: TestCase[];
  error: string | null;
  selected: TestSelection | null;
  /** PUT/DELETE в процессе. */
  saving: boolean;
  /** 422 или прочая ошибка сохранения/удаления — показывается в форме, черновик не сбрасывается. */
  saveError: string | null;
  conflict: TestsConflict | null;
  /** Растёт при перезагрузке после 409: формы пересоздаются с данными сервера, черновик отброшен. */
  reloadSeq: number;
  /** Последняя проверка поведения (POST verify / FixResult.verify). */
  verify: Schemas['VerifyResult'] | null;
  /** Версия проекта, на которой получены результаты (для пометки «устарели»). */
  resultsVersion: number | null;
  /** Последний запуск (POST run). */
  run: Schemas['RunResult'] | null;
  /** Пришёл запуск, но выбор не переключён (в форме несохранённые правки) — пункт «Последний запуск» с бейджем. */
  runUnseen: boolean;
  /** В открытой форме есть несохранённые правки. */
  dirty: boolean;
  /** Черновик, возвращённый после 409 («Повторить с моей правкой»): форма открывается с ним. */
  restored: TestDraft | null;

  select: (selection: TestSelection | null) => void;
  /** GET tests. */
  load: (client: ApiClient, projectId: string) => Promise<void>;
  /** PUT tests/{name} с версией проекта. `isNew` — не затирать существующий тест с тем же именем. */
  save: (client: ApiClient, projectId: string, test: TestCase, isNew: boolean) => Promise<boolean>;
  /** DELETE tests/{name}?version=. */
  remove: (client: ApiClient, projectId: string, test: TestCase) => Promise<boolean>;
  /** Показать результат проверки поведения (FE-13 передаёт сюда ответ POST verify). */
  showVerifyResult: (result: Schemas['VerifyResult']) => void;
  /** Показать результат запуска (FE-13 передаёт сюда ответ POST run). */
  showRunResult: (result: Schemas['RunResult']) => void;
  dismissConflict: () => void;
  clearSaveError: () => void;
  setDirty: (dirty: boolean) => void;
  /** Вернуть черновик из 409 в форму (сохранить его затем можно с новой версией). */
  restoreDraft: () => void;
}

const initial = {
  projectId: null,
  status: 'idle' as TestsStatus,
  tests: [] as TestCase[],
  error: null,
  selected: null,
  saving: false,
  saveError: null,
  conflict: null,
  reloadSeq: 0,
  verify: null,
  resultsVersion: null,
  run: null,
  runUnseen: false,
  dirty: false,
  restored: null,
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/** Версия проекта из общего стора; ещё не известна — GET /projects/{id}. */
async function currentVersion(client: ApiClient, projectId: string): Promise<number> {
  const known = useAppStore.getState().version;
  if (known !== null) return known;
  const { data, error, response } = await client.GET('/projects/{projectId}', { params: { path: { projectId } } });
  if (!data) throw new Error(error?.message ?? `HTTP ${response.status}`);
  useAppStore.getState().setVersion(data.version);
  return data.version;
}

function sameTest(a: Pick<TestCase, 'type' | 'name'>, b: Pick<TestCase, 'type' | 'name'>): boolean {
  return a.type === b.type && a.name === b.name;
}

/** Состояние панели тестов: список тестов проекта, выбор, последние результаты проверки и запуска. */
export const useTestsStore = create<TestsState>()((set, get) => {
  /** 409: тост, черновик отброшен, версия и список перезагружены (как FileSync). */
  async function onConflict(client: ApiClient, projectId: string, err: Schemas['Error'] | undefined, draft?: TestDraft) {
    const e = err ?? { code: 'VERSION_CONFLICT' as const, message: 'HTTP 409' };
    set((s) => ({
      saving: false,
      saveError: null,
      reloadSeq: s.reloadSeq + 1,
      dirty: false,
      restored: null,
      conflict: {
        draft,
        clientVersion: asNumber(e.details?.clientVersion),
        serverVersion: asNumber(e.details?.serverVersion),
        message: e.message,
        seq: (s.conflict?.seq ?? 0) + 1,
      },
    }));
    try {
      const { data } = await client.GET('/projects/{projectId}', { params: { path: { projectId } } });
      if (data) useAppStore.getState().setVersion(data.version);
    } catch {
      // Версию подтянет следующая попытка сохранения (currentVersion).
    }
    await get().load(client, projectId);
  }

  return {
    ...initial,
    select: (selected) =>
      set((s) => ({
        selected,
        saveError: null,
        dirty: false,
        restored: null,
        runUnseen: selected?.kind === 'run' ? false : s.runUnseen,
      })),

    load: async (client, projectId) => {
      const otherProject = get().projectId !== projectId;
      set({
        projectId,
        status: 'loading',
        error: null,
        ...(otherProject
          ? {
              tests: [],
              selected: null,
              verify: null,
              run: null,
              runUnseen: false,
              resultsVersion: null,
              dirty: false,
              restored: null,
            }
          : {}),
      });
      try {
        const { data, error, response } = await client.GET('/projects/{projectId}/tests', {
          params: { path: { projectId } },
        });
        if (get().projectId !== projectId) return;
        if (data) {
          const sel = get().selected;
          // Выбранный тест исчез после перезагрузки — снять выбор.
          const keep = sel?.kind !== 'test' || data.some((t) => sameTest(t, sel));
          set({ tests: data, status: 'ok', ...(keep ? {} : { selected: null }) });
        } else {
          set({ status: 'error', error: error?.message ?? `HTTP ${response.status}` });
        }
      } catch (e: unknown) {
        if (get().projectId === projectId) set({ status: 'error', error: errorMessage(e) });
      }
    },

    save: async (client, projectId, test, isNew) => {
      const name = test.name.trim();
      if (!name) {
        set({ saveError: 'Укажите имя теста' });
        return false;
      }
      if (isNew && get().tests.some((t) => t.name === name)) {
        set({ saveError: `Тест «${name}» уже есть` });
        return false;
      }
      set({ saving: true, saveError: null });
      try {
        const version = await currentVersion(client, projectId);
        const { data, error, response } = await client.PUT('/projects/{projectId}/tests/{name}', {
          params: { path: { projectId, name } },
          body: { ...test, name, version },
        });
        if (data) {
          useAppStore.getState().setVersion(data.version);
          const saved = data.test;
          set((s) => {
            const exists = s.tests.some((t) => sameTest(t, saved));
            return {
              saving: false,
              dirty: false,
              restored: null,
              tests: exists ? s.tests.map((t) => (sameTest(t, saved) ? saved : t)) : [...s.tests, saved],
              selected: { kind: 'test', type: saved.type, name: saved.name },
            };
          });
          return true;
        }
        if (response.status === 409) {
          await onConflict(client, projectId, error, { test: { ...test, name }, isNew });
          return false;
        }
        set({ saving: false, saveError: error?.message ?? `HTTP ${response.status}` });
        return false;
      } catch (e: unknown) {
        set({ saving: false, saveError: errorMessage(e) });
        return false;
      }
    },

    remove: async (client, projectId, test) => {
      set({ saving: true, saveError: null });
      try {
        const version = await currentVersion(client, projectId);
        const { data, error, response } = await client.DELETE('/projects/{projectId}/tests/{name}', {
          params: { path: { projectId, name: test.name }, query: { version } },
        });
        if (data) {
          useAppStore.getState().setVersion(data.version);
          set((s) => ({
            saving: false,
            tests: s.tests.filter((t) => !sameTest(t, test)),
            selected: null,
            dirty: false,
          }));
          return true;
        }
        if (response.status === 409) {
          await onConflict(client, projectId, error);
          return false;
        }
        set({ saving: false, saveError: error?.message ?? `HTTP ${response.status}` });
        return false;
      } catch (e: unknown) {
        set({ saving: false, saveError: errorMessage(e) });
        return false;
      }
    },

    showVerifyResult: (verify) => set({ verify, resultsVersion: useAppStore.getState().version }),
    // Несохранённую правку не размонтируем: запуск ждёт в списке с бейджем «новый».
    showRunResult: (run) =>
      set((s) => (s.dirty ? { run, runUnseen: true } : { run, runUnseen: false, selected: { kind: 'run' } })),
    dismissConflict: () => set({ conflict: null }),
    clearSaveError: () => set({ saveError: null }),
    setDirty: (dirty) => {
      if (get().dirty !== dirty) set({ dirty });
    },
    restoreDraft: () => {
      const draft = get().conflict?.draft;
      if (!draft) return;
      // Тест исчез с сервера — возвращаем правку как новый тест.
      const exists = get().tests.some((t) => sameTest(t, draft.test));
      const restored: TestDraft = { test: draft.test, isNew: draft.isNew || !exists };
      set((s) => ({
        conflict: null,
        restored,
        dirty: true,
        saveError: null,
        reloadSeq: s.reloadSeq + 1,
        selected: restored.isNew
          ? { kind: 'new', type: restored.test.type }
          : { kind: 'test', type: restored.test.type, name: restored.test.name },
      }));
    },
  };
});

/** Сброс (тесты). */
export function resetTestsState(): void {
  useTestsStore.setState({ ...initial });
}

/** Список тестов открытого проекта: грузит при смене projectId из `useAppStore`. */
export function useTests(client: ApiClient) {
  const projectId = useAppStore((s) => s.projectId);
  const load = useTestsStore((s) => s.load);
  useEffect(() => {
    if (projectId) void load(client, projectId);
  }, [client, projectId, load]);
  return projectId;
}
