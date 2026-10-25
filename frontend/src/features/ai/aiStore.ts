import { create } from 'zustand';
import type { ApiClient, Schemas } from '../api';
import { useAnalysisStore } from '../analysis-panel/analysisStore';
import { reloadAfterConflict } from '../fix/fixStore';
import { reloadProjectTree } from '../project-tree';
import { useAppStore } from '../../app/store';
import { aiErrorText } from './aiError';

type Proposal = Schemas['AiEditProposal'];

/** «Объясни метод»: markdown-текст из ответа. */
export interface ExplainDialog {
  kind: 'explain';
  title: string;
  /** null — запрос в полёте. */
  text: string | null;
  error: string | null;
}

/** «Изменить текстом (ИИ)»: инструкция → дифф → «Применить» / «Отмена». Сразу ничего не применяется. */
export interface EditDialog {
  kind: 'edit';
  title: string;
  methodId: string;
  blockId: string;
  /** input — ввод инструкции; loading — запрос предложения; diff — показан дифф; applying — идёт PUT files. */
  stage: 'input' | 'loading' | 'diff' | 'applying';
  proposal: Proposal | null;
  error: string | null;
}

export type AiDialogState = ExplainDialog | EditDialog;

interface AiState {
  dialog: AiDialogState | null;
  client: ApiClient | null;
  explain: (client: ApiClient, methodId: string, title: string) => Promise<void>;
  openEdit: (client: ApiClient, methodId: string, blockId: string, title: string) => void;
  propose: (instruction: string) => Promise<void>;
  /** PUT /files?path= с text и version из предложения (то же, что правка в «Код Java»). */
  apply: () => Promise<void>;
  close: () => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const CONFLICT = 'Проект изменился — состояние перезагружено. Повторите.';

export const useAiStore = create<AiState>()((set, get) => {
  const patch = (p: Partial<EditDialog> | Partial<ExplainDialog>, kind: AiDialogState['kind']) =>
    set((s) => (s.dialog?.kind === kind ? { dialog: { ...s.dialog, ...p } as AiDialogState } : s));
  const ids = () => {
    const { projectId, version } = useAppStore.getState();
    return projectId !== null && version !== null ? { projectId, version } : null;
  };

  return {
    dialog: null,
    client: null,

    explain: async (client, methodId, title) => {
      const at = ids();
      if (!at) return;
      set({ client, dialog: { kind: 'explain', title, text: null, error: null } });
      try {
        const { data, error, response } = await client.POST('/projects/{projectId}/methods/{methodId}/explain', {
          params: { path: { projectId: at.projectId, methodId } },
          body: { version: at.version },
        });
        if (data) patch({ text: data.text }, 'explain');
        else if (response.status === 409) {
          patch({ error: CONFLICT }, 'explain');
          await reloadAfterConflict(client, at.projectId);
        } else patch({ error: aiErrorText(error, response.status) }, 'explain');
      } catch (e: unknown) {
        patch({ error: `Сервер недоступен: ${errorText(e)}` }, 'explain');
      }
    },

    openEdit: (client, methodId, blockId, title) =>
      set({ client, dialog: { kind: 'edit', title, methodId, blockId, stage: 'input', proposal: null, error: null } }),

    propose: async (instruction) => {
      const { dialog, client } = get();
      const at = ids();
      if (dialog?.kind !== 'edit' || !client || !at || !instruction.trim()) return;
      patch({ stage: 'loading', error: null }, 'edit');
      try {
        const { data, error, response } = await client.POST('/projects/{projectId}/methods/{methodId}/ai-edit', {
          params: { path: { projectId: at.projectId, methodId: dialog.methodId } },
          body: { version: at.version, blockId: dialog.blockId, instruction: instruction.trim() },
        });
        if (data) patch({ stage: 'diff', proposal: data }, 'edit');
        else if (response.status === 409) {
          patch({ stage: 'input', error: CONFLICT }, 'edit');
          await reloadAfterConflict(client, at.projectId);
        } else patch({ stage: 'input', error: aiErrorText(error, response.status) }, 'edit');
      } catch (e: unknown) {
        patch({ stage: 'input', error: `Сервер недоступен: ${errorText(e)}` }, 'edit');
      }
    },

    apply: async () => {
      const { dialog, client } = get();
      const projectId = useAppStore.getState().projectId;
      if (dialog?.kind !== 'edit' || dialog.stage !== 'diff' || !dialog.proposal || !client || !projectId) return;
      const { path, text, version } = dialog.proposal;
      patch({ stage: 'applying', error: null }, 'edit');
      try {
        const { data, error, response } = await client.PUT('/projects/{projectId}/files', {
          params: { path: { projectId }, query: { path } },
          body: { version, text },
        });
        if (data) {
          // Как у правки в «Код Java»: версия, анализ из ответа, дерево; холст и код перечитаются по version.
          useAppStore.getState().setVersion(data.version);
          useAnalysisStore.getState().setAnalysis(projectId, data.analysis);
          void reloadProjectTree();
          set({ dialog: null });
        } else if (response.status === 409) {
          patch({ stage: 'input', proposal: null, error: CONFLICT }, 'edit');
          await reloadAfterConflict(client, projectId);
        } else {
          const line = response.status === 422 && error?.line ? ` (строка ${error.line})` : '';
          patch({ stage: 'diff', error: `${aiErrorText(error, response.status)}${line}` }, 'edit');
        }
      } catch (e: unknown) {
        patch({ stage: 'diff', error: `Сервер недоступен: ${errorText(e)}` }, 'edit');
      }
    },

    close: () => {
      const d = get().dialog;
      if (d?.kind === 'edit' && d.stage === 'applying') return;
      set({ dialog: null });
    },
  };
});

/** Сброс (тесты). */
export function resetAiState(): void {
  useAiStore.setState({ dialog: null, client: null });
}
