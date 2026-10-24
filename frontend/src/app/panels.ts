import type { ComponentType } from 'react';
import { stubPanel } from '../features/layout';
import { MetricsTab, ProblemsTab, WarningsTab } from '../features/analysis-panel';
import { TestsPanel } from '../features/tests-panel';
import { DependenciesTab, UmlTab } from '../features/diagrams';
import { STRUCTURE_PANEL_ID, StructurePanel } from '../features/project-tree';
import { SelectedMethodCode } from './methodViews';

/**
 * Зона экрана, где живёт вкладка: правая панель (анализ), нижняя (код / консоль / тесты) или центральная
 * (`canvas`: вкладки после встроенной «схемы метода» — UML, граф зависимостей).
 */
export type PanelArea = 'right' | 'bottom' | 'canvas';

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
  // FE-10: формы класса/поля/метода; выбор класса или поля в дереве открывает эту вкладку.
  { id: STRUCTURE_PANEL_ID, title: 'Свойства', area: 'right', component: StructurePanel },
  { id: 'bottom.code', title: 'Код Java', area: 'bottom', component: SelectedMethodCode },
  { id: 'bottom.console', title: 'Консоль', area: 'bottom', component: stubPanel('Вывод запуска — появится в FE-13') },
  { id: 'bottom.tests', title: 'Результат тестов', area: 'bottom', component: TestsPanel },
  // Диаграммы — ленивый чанк (features/diagrams/lazyTabs.tsx), основной бандл не растёт.
  { id: 'canvas.uml', title: 'UML', area: 'canvas', component: UmlTab },
  { id: 'canvas.deps', title: 'Зависимости', area: 'canvas', component: DependenciesTab },
];

export function panelsIn(area: PanelArea, list: readonly PanelDef[] = panels): PanelDef[] {
  return list.filter((p) => p.area === area);
}

export function findPanel(id: string): PanelDef | undefined {
  return panels.find((p) => p.id === id);
}
