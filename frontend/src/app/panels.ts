import type { ComponentType } from 'react';
import { stubPanel } from '../features/layout';
import { MetricsTab, ProblemsTab, WarningsTab } from '../features/analysis-panel';
import { SelectedMethodCode } from './methodViews';

/** Зона экрана, где живёт вкладка: правая панель (анализ) или нижняя (код / консоль / тесты). */
export type PanelArea = 'right' | 'bottom';

export interface PanelDef {
  /** Уникальный id вкладки, напр. 'analysis.problems'. */
  id: string;
  title: string;
  area: PanelArea;
  component: ComponentType;
}

/**
 * Реестр вкладок панелей. Новая вкладка = новый элемент списка; порядок в списке = порядок вкладок.
 * Фича подключается заменой `component` заглушки на свой компонент.
 */
export const panels: readonly PanelDef[] = [
  { id: 'analysis.problems', title: 'Проблемы', area: 'right', component: ProblemsTab },
  { id: 'analysis.warnings', title: 'Предупреждения', area: 'right', component: WarningsTab },
  { id: 'analysis.metrics', title: 'Метрики', area: 'right', component: MetricsTab },
  { id: 'bottom.code', title: 'Код Java', area: 'bottom', component: SelectedMethodCode },
  { id: 'bottom.console', title: 'Консоль', area: 'bottom', component: stubPanel('Вывод запуска — появится в FE-13') },
  {
    id: 'bottom.tests',
    title: 'Результат тестов',
    area: 'bottom',
    component: stubPanel('Результаты тестов — появятся в FE-12'),
  },
];

export function panelsIn(area: PanelArea, list: readonly PanelDef[] = panels): PanelDef[] {
  return list.filter((p) => p.area === area);
}

export function findPanel(id: string): PanelDef | undefined {
  return panels.find((p) => p.id === id);
}
