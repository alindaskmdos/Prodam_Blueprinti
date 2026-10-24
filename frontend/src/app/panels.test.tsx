import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PanelTabs } from '../features/layout';
import { panels, panelsIn, type PanelDef } from './panels';
import { resetAppState, useAppStore } from './store';

describe('реестр вкладок panels.ts', () => {
  afterEach(() => resetAppState());

  it('id уникальны, в каждой зоне есть вкладки', () => {
    expect(new Set(panels.map((p) => p.id)).size).toBe(panels.length);
    expect(panelsIn('right').map((p) => p.id)).toEqual(['analysis.problems', 'analysis.warnings', 'analysis.metrics', 'structure.props']);
    expect(panelsIn('bottom').map((p) => p.id)).toEqual(['bottom.code', 'bottom.console', 'bottom.tests']);
  });

  it('PanelTabs отрисовывает вкладки из списка и переключает содержимое', () => {
    const list: PanelDef[] = [
      { id: 'a', title: 'Первая', area: 'right', component: () => <p>содержимое A</p> },
      { id: 'b', title: 'Вторая', area: 'right', component: () => <p>содержимое B</p> },
      { id: 'c', title: 'Снизу', area: 'bottom', component: () => <p>содержимое C</p> },
    ];
    render(<PanelTabs title="Анализ" tabs={panelsIn('right', list)} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Первая', 'Вторая']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('содержимое A')).toBeInTheDocument();

    const second = screen.getByRole('tab', { name: 'Вторая' });
    fireEvent.click(second);
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('содержимое B')).toBeInTheDocument();
    expect(screen.queryByText('содержимое A')).not.toBeInTheDocument();
    expect(screen.queryByText('содержимое C')).not.toBeInTheDocument();
  });

  it('вкладки нижней зоны рендерятся: «Код Java» без выбранного метода — подсказка, заглушки — по клику', () => {
    useAppStore.getState().openProject('p-1');
    render(<PanelTabs tabs={panelsIn('bottom')} aria-label="низ" />);
    expect(screen.getByTestId('panel-stub')).toHaveTextContent('Выберите метод в дереве проекта');
    fireEvent.click(screen.getByRole('tab', { name: 'Консоль' }));
    expect(screen.getByTestId('panel-stub')).toHaveTextContent('FE-13');
  });
});
