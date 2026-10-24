import { create } from 'zustand';

/** Сворачиваемые области каркаса: дерево проекта, панель анализа, нижняя панель. */
export type LayoutArea = 'left' | 'right' | 'bottom';

export const LAYOUT_AREAS: readonly LayoutArea[] = ['left', 'right', 'bottom'];

export const AREA_TITLE: Record<LayoutArea, string> = { left: 'Проект', right: 'Анализ', bottom: 'Код · Консоль · Тесты' };

export interface LayoutState {
  collapsed: Record<LayoutArea, boolean>;
  /** Области, которые были открыты до «Только схема» (чтобы вернуть); null — режим выключен. */
  stash: LayoutArea[] | null;
  setCollapsed: (area: LayoutArea, collapsed: boolean) => void;
  toggle: (area: LayoutArea) => void;
  /** «Только схема»: свернуть всё; повторно — вернуть то, что было открыто. */
  toggleCanvasOnly: () => void;
}

const open = { left: false, right: false, bottom: false };

export const useLayoutStore = create<LayoutState>()((set, get) => ({
  collapsed: open,
  stash: null,
  setCollapsed: (area, collapsed) =>
    set((s) => (s.collapsed[area] === collapsed ? s : { collapsed: { ...s.collapsed, [area]: collapsed } })),
  toggle: (area) => get().setCollapsed(area, !get().collapsed[area]),
  toggleCanvasOnly: () => {
    const { collapsed, stash } = get();
    if (stash) {
      set({
        collapsed: { left: !stash.includes('left'), right: !stash.includes('right'), bottom: !stash.includes('bottom') },
        stash: null,
      });
    } else {
      const visible = LAYOUT_AREAS.filter((a) => !collapsed[a]);
      // Всё уже свёрнуто вручную — режим «вернуть» разворачивает все панели.
      if (visible.length === 0) set({ collapsed: { ...open } });
      else set({ collapsed: { left: true, right: true, bottom: true }, stash: visible });
    }
  },
}));

/** Развернуть область, если она свёрнута (showPanel: вкладка в свёрнутой панели должна быть видна). */
export function revealArea(area: string): void {
  if (area === 'left' || area === 'right' || area === 'bottom') useLayoutStore.getState().setCollapsed(area, false);
}

/** Сброс (тесты). */
export function resetLayoutState(): void {
  useLayoutStore.setState({ collapsed: { ...open }, stash: null });
}
