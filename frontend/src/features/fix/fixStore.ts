import { create } from 'zustand';
import type { ApiClient, Schemas } from '../api';
import { useAnalysisStore } from '../analysis-panel/analysisStore';
import { reloadProjectTree } from '../project-tree';
import { useTestsStore } from '../tests-panel';
import { useAppStore } from '../../app/store';
import { aiErrorText } from '../ai/aiError';

type Issue = Schemas['Issue'];
type FixResult = Schemas['FixResult'];

/** Открытый диалог Quality Gate. */
export interface FixGate {
  issue: Issue;
  fixId: string;
  /** Версия, с которой применялся фикс (версия анализа, где получен Issue.id). */
  fromVersion: number;
  /** Analysis.n, для которого посчитаны Issue.complexity.opsBefore/opsAfter. */
  n: number;
  /** null — запрос в полёте. */
  result: FixResult | null;
  /** 404 / сеть / 5xx — фикс не дошёл до Quality Gate. */
  error: string | null;
}

export interface FixConflict {
  message: string;
  seq: number;
}

interface FixState {
  gate: FixGate | null;
  /** 409: проект изменён, фикс не применён, состояние перезагружено. */
  conflict: FixConflict | null;
  /**
   * POST /issues/{issueId}/fix → Quality Gate. `version` — версия анализа, из которого взят Issue.
   * applied → новая версия в store, анализ из ответа, перезагрузка дерева (холст и код подтянутся по version);
   * rejected → версия прежняя; 409 → тост и перезагрузка.
   */
  apply: (client: ApiClient, projectId: string, issue: Issue, fixId: string, version: number, ai?: boolean) => Promise<void>;
  /** «Предложить фикс (ИИ)»: POST /issues/{issueId}/ai-fix → тот же Quality Gate (диалог, applied/rejected, 409). */
  applyAi: (client: ApiClient, projectId: string, issue: Issue, version: number) => Promise<void>;
  close: () => void;
  dismissConflict: () => void;
}

let conflictSeq = 0;

/** Подпись фикса от ИИ в диалоге Quality Gate (вместо id из Issue.fixes). */
export const AI_FIX_ID = 'ИИ';

/** Перезагрузка после 409: версия (GET project) и дерево; анализ, холст и код перезагрузятся по version. */
export async function reloadAfterConflict(client: ApiClient, projectId: string): Promise<void> {
  try {
    const { data } = await client.GET('/projects/{projectId}', { params: { path: { projectId } } });
    if (data && useAppStore.getState().projectId === projectId) useAppStore.getState().setVersion(data.version);
  } catch {
    // Версия не получена — дерево всё равно перезагрузим.
  }
  await reloadProjectTree();
}

export const useFixStore = create<FixState>()((set, get) => ({
  gate: null,
  conflict: null,

  applyAi: (client, projectId, issue, version) => get().apply(client, projectId, issue, AI_FIX_ID, version, true),

  apply: async (client, projectId, issue, fixId, version, ai = false) => {
    if (isFixRunning(get().gate)) return;
    const n = useAnalysisStore.getState().analysis?.n ?? useAnalysisStore.getState().n;
    set({ gate: { issue, fixId, fromVersion: version, n, result: null, error: null } });
    const stillOpen = () => get().gate?.issue.id === issue.id && get().gate?.fixId === fixId;
    try {
      const params = { path: { projectId, issueId: issue.id } };
      const { data, error, response } = ai
        ? await client.POST('/projects/{projectId}/issues/{issueId}/ai-fix', { params, body: { version } })
        : await client.POST('/projects/{projectId}/issues/{issueId}/fix', { params, body: { version, fixId } });
      if (data) {
        if (data.applied) {
          const app = useAppStore.getState();
          if (app.projectId === projectId) {
            app.setVersion(data.version);
            // Issue.id действителен только для старой версии — выбор проблемы снимаем.
            app.selectIssue(null);
          }
          if (data.mutation?.analysis) useAnalysisStore.getState().setAnalysis(projectId, data.mutation.analysis);
          void reloadProjectTree();
        }
        if (data.verify) useTestsStore.getState().showVerifyResult(data.verify);
        if (stillOpen()) set((s) => ({ gate: s.gate && { ...s.gate, result: data } }));
        return;
      }
      if (response.status === 409) {
        conflictSeq += 1;
        set({
          gate: null,
          conflict: {
            message: 'Проект изменился, пока применялся фикс. Фикс не применён — состояние перезагружено, проверьте анализ заново.',
            seq: conflictSeq,
          },
        });
        await reloadAfterConflict(client, projectId);
        return;
      }
      const message =
        response.status === 404
          ? 'Проблема не найдена — анализ устарел. Обновите анализ и попробуйте снова.'
          : aiErrorText(error, response.status);
      if (stillOpen()) set((s) => ({ gate: s.gate && { ...s.gate, error: message } }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (stillOpen()) set((s) => ({ gate: s.gate && { ...s.gate, error: `Сервер недоступен: ${message}` } }));
    }
  },

  close: () => {
    // Пока идёт Quality Gate, диалог не закрываем: результат должен быть виден.
    if (isFixRunning(get().gate)) return;
    set({ gate: null });
  },
  dismissConflict: () => set({ conflict: null }),
}));

/** Идёт ли сейчас Quality Gate (кнопки запуска/проверки неактивны). */
export function isFixRunning(gate: FixGate | null): boolean {
  return gate !== null && gate.result === null && gate.error === null;
}

/** Сброс (тесты). */
export function resetFixState(): void {
  useFixStore.setState({ gate: null, conflict: null });
}
