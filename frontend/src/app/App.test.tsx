import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import treeJson from '@contract/fixtures/tree.json';
import { createApiClient } from '../features/api';
import { App } from './App';
import { resetAppState, useAppStore } from './store';

const client = createApiClient('http://localhost/api');
const merge = treeJson.packages[0]?.files[0]?.classes[0]?.methods[0];
if (!merge) throw new Error('в tree.json нет метода');

describe('App — каркас редактора на MSW', () => {
  beforeEach(() => resetAppState());

  it('рендерит шапку, дерево из tree.json, холст и обе панели вкладок', async () => {
    render(<App client={client} />);

    expect(screen.getByText('Java Blueprints')).toBeInTheDocument();
    const firstPackage = treeJson.packages[0]?.name ?? '';
    expect(await screen.findByText(firstPackage)).toBeInTheDocument();
    expect(screen.getByText('OrderService')).toBeInTheDocument();
    expect(screen.getByText('orders')).toBeInTheDocument();

    expect(await screen.findByText(/версия 1/)).toBeInTheDocument();
    expect(await screen.findByText('Main.main')).toBeInTheDocument();
    expect(screen.getByText('Выберите метод в дереве проекта')).toBeInTheDocument();

    expect(screen.getAllByRole('tablist')).toHaveLength(2);
    const right = screen.getByRole('tablist', { name: 'Анализ' });
    const bottom = screen.getByRole('tablist', { name: 'Код, консоль, тесты' });
    expect(within(right).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Проблемы',
      'Предупреждения',
      'Метрики',
    ]);
    expect(within(bottom).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Код Java',
      'Консоль',
      'Результат тестов',
    ]);
    expect(useAppStore.getState().projectId).toBe('p-1');
    expect(useAppStore.getState().version).toBe(treeJson.version);
  });

  it('клик по методу в дереве выбирает methodId и открывает его на холсте', async () => {
    render(<App client={client} />);

    const button = await screen.findByRole('button', { name: new RegExp(merge.name) });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);

    expect(useAppStore.getState().selectedMethodId).toBe(merge.id);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('canvas-method')).toHaveTextContent('OrderService.merge');
  });

  it('слот холста подставляет переданный компонент', async () => {
    render(<App client={client} canvas={<div>холст FE-03</div>} />);
    expect(await screen.findByText('OrderService')).toBeInTheDocument();
    expect(screen.getByText('холст FE-03')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas-stub')).not.toBeInTheDocument();
  });
});
