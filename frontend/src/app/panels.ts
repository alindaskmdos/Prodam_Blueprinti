import type { ComponentType } from 'react';

/** Зона экрана, где живёт вкладка (каркас — FE-02). */
export type PanelZone = 'left' | 'right' | 'bottom';

export interface PanelDef {
  /** Уникальный id вкладки, напр. 'analysis.problems'. */
  id: string;
  title: string;
  zone: PanelZone;
  /** Порядок внутри зоны (меньше — левее). */
  order: number;
  component: ComponentType;
}

/** Реестр вкладок панелей. Новая вкладка = новый элемент списка. */
export const panels: readonly PanelDef[] = [];

export function panelsIn(zone: PanelZone): PanelDef[] {
  return panels.filter((p) => p.zone === zone).sort((a, b) => a.order - b.order);
}
