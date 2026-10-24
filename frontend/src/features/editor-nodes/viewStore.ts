import { create } from 'zustand';
import type { CollapseOverrides } from './collapse';

/** Ключ localStorage переключателя «Комментарии». */
export const SHOW_COMMENTS_KEY = 'jb.editor.showComments';

/** Ключи localStorage: палитра блоков раскрыта / мини-карта показана (по умолчанию нет — они закрывают схему). */
export const PALETTE_OPEN_KEY = 'jb.editor.paletteOpen';
export const SHOW_MINIMAP_KEY = 'jb.editor.showMinimap';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = globalThis.localStorage?.getItem(key);
    return v === null || v === undefined ? fallback : v === 'true';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, String(value));
  } catch {
    // Хранилище недоступно (приватный режим) — переключатель живёт до перезагрузки страницы.
  }
}

const readShowComments = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(SHOW_COMMENTS_KEY) !== 'false';
  } catch {
    return true;
  }
};

const EMPTY: CollapseOverrides = {};

interface EditorViewState {
  /** Показывать comment-блоки на схеме (по умолчанию да). Только вид: дерево в PUT — всегда полное. */
  showComments: boolean;
  /** Палитра блоков раскрыта (по умолчанию свёрнута в кнопку «+ Блок»). */
  paletteOpen: boolean;
  /** Мини-карта показана (по умолчанию скрыта; кнопка в Controls). */
  showMinimap: boolean;
  /** Сворачивание по методам: methodId → ключ контейнера → свёрнут ли (переопределения пользователя). */
  collapsed: Readonly<Record<string, CollapseOverrides>>;
  setShowComments: (value: boolean) => void;
  setPaletteOpen: (value: boolean) => void;
  setShowMinimap: (value: boolean) => void;
  /** Свернуть / развернуть контейнеры метода по ключам (collapse.ts: blockKey). */
  setCollapsed: (methodId: string, keys: readonly string[], value: boolean) => void;
  /** Забыть переопределения ключей — контейнеры вернутся к начальному состоянию. */
  resetCollapsed: (methodId: string, keys: readonly string[]) => void;
}

/** Вид схемы метода (FE-06): сворачивание контейнеров и переключатель комментариев. На сервер не уходит. */
export const useEditorView = create<EditorViewState>()((set) => ({
  showComments: readShowComments(),
  paletteOpen: readFlag(PALETTE_OPEN_KEY, false),
  showMinimap: readFlag(SHOW_MINIMAP_KEY, false),
  collapsed: {},
  setShowComments: (value) => {
    writeFlag(SHOW_COMMENTS_KEY, value);
    set({ showComments: value });
  },
  setPaletteOpen: (value) => {
    writeFlag(PALETTE_OPEN_KEY, value);
    set({ paletteOpen: value });
  },
  setShowMinimap: (value) => {
    writeFlag(SHOW_MINIMAP_KEY, value);
    set({ showMinimap: value });
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
  useEditorView.setState({
    showComments: readShowComments(),
    paletteOpen: readFlag(PALETTE_OPEN_KEY, false),
    showMinimap: readFlag(SHOW_MINIMAP_KEY, false),
    collapsed: {},
  });
}
