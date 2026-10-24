import { create } from 'zustand';
import type { CollapseOverrides } from './collapse';

/** Ключ localStorage переключателя «Комментарии». */
export const SHOW_COMMENTS_KEY = 'jb.editor.showComments';

function readShowComments(): boolean {
  try {
    return globalThis.localStorage?.getItem(SHOW_COMMENTS_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeShowComments(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(SHOW_COMMENTS_KEY, String(value));
  } catch {
    // Хранилище недоступно (приватный режим) — переключатель живёт до перезагрузки страницы.
  }
}

const EMPTY: CollapseOverrides = {};

interface EditorViewState {
  /** Показывать comment-блоки на схеме (по умолчанию да). Только вид: дерево в PUT — всегда полное. */
  showComments: boolean;
  /** Сворачивание по методам: methodId → ключ контейнера → свёрнут ли (переопределения пользователя). */
  collapsed: Readonly<Record<string, CollapseOverrides>>;
  setShowComments: (value: boolean) => void;
  /** Свернуть / развернуть контейнеры метода по ключам (collapse.ts: blockKey). */
  setCollapsed: (methodId: string, keys: readonly string[], value: boolean) => void;
  /** Забыть переопределения ключей — контейнеры вернутся к начальному состоянию. */
  resetCollapsed: (methodId: string, keys: readonly string[]) => void;
}

/** Вид схемы метода (FE-06): сворачивание контейнеров и переключатель комментариев. На сервер не уходит. */
export const useEditorView = create<EditorViewState>()((set) => ({
  showComments: readShowComments(),
  collapsed: {},
  setShowComments: (value) => {
    writeShowComments(value);
    set({ showComments: value });
  },
  setCollapsed: (methodId, keys, value) => {
    if (keys.length === 0) return;
    set((s) => {
      const next = { ...(s.collapsed[methodId] ?? EMPTY) };
      for (const k of keys) next[k] = value;
      return { collapsed: { ...s.collapsed, [methodId]: next } };
    });
  },
  resetCollapsed: (methodId, keys) => {
    set((s) => {
      const prev = s.collapsed[methodId];
      if (!prev || !keys.some((k) => k in prev)) return s;
      const drop = new Set(keys);
      const next = Object.fromEntries(Object.entries(prev).filter(([k]) => !drop.has(k)));
      return { collapsed: { ...s.collapsed, [methodId]: next } };
    });
  },
}));

/** Переопределения сворачивания метода (стабильная ссылка, пока не менялись). */
export function useCollapseOverrides(methodId: string): CollapseOverrides {
  return useEditorView((s) => s.collapsed[methodId] ?? EMPTY);
}

/** Сброс для тестов. */
export function resetEditorView(): void {
  useEditorView.setState({ showComments: readShowComments(), collapsed: {} });
}
