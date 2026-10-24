import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import runJson from '@contract/fixtures/run.ok.json';
import { createApiClient } from '../features/api';
import { resetAnalysisState } from '../features/analysis-panel';
import { resetLayoutState, useLayoutStore } from '../features/layout';
import { resetTreeState } from '../features/project-tree';
import { resetSandboxState } from '../features/sandbox';
import { resetTestsState, useTestsStore } from '../features/tests-panel';
import { App } from './App';
import { findCommand } from './commands';
import { resetAppState, useAppStore } from './store';

const client = createApiClient('http://localhost/api');

beforeEach(() => {
  resetAppState();
  resetTreeState();
  resetAnalysisState();
  resetTestsState();
  resetSandboxState();
  resetLayoutState();
});
afterEach(() => resetLayoutState());

const collapsed = () => useLayoutStore.getState().collapsed;
const key = (init: KeyboardEventInit) => fireEvent.keyDown(window, init);

describe('FE-36: каркас — панели и шапка', () => {
  it('шапка показывает имя загруженной папки, а id — в подсказке; без имени — id', () => {
    useAppStore.getState().openProject('p-3', 1, 'demo');
    render(<App client={client} projectId="p-3" canvas={<div>холст</div>} />);
    const label = screen.getByTestId('project-label');
    expect(label).toHaveTextContent(/^demo$/);
    expect(label).toHaveAttribute('data-version', '1');
    expect(label).toHaveAttribute('title', 'id: p-3');
  });

  it('без имени шапка показывает id', () => {
    render(<App client={client} projectId="p-3" canvas={<div>холст</div>} />);
    expect(screen.getByTestId('project-label')).toHaveTextContent('p-3');
  });

  it('Ctrl+B / Ctrl+J / Ctrl+Alt+B сворачивают панели (в т.ч. в русской раскладке — по code), Ctrl+\\ — «Только схема»', () => {
    render(<App client={client} projectId="p-1" canvas={<div>холст</div>} />);
    key({ ctrlKey: true, key: 'и', code: 'KeyB' });
    expect(collapsed()).toEqual({ left: true, right: false, bottom: false });
    key({ ctrlKey: true, key: 'j', code: 'KeyJ' });
    key({ ctrlKey: true, altKey: true, key: 'b', code: 'KeyB' });
    expect(collapsed()).toEqual({ left: true, right: true, bottom: true });
    key({ ctrlKey: true, key: 'b', code: 'KeyB' });
    expect(collapsed().left).toBe(false);
    // «Только схема»: всё свернуть, повторно — вернуть то, что было открыто (слева — открыто)
    key({ ctrlKey: true, key: '\\', code: 'Backslash' });
    expect(collapsed()).toEqual({ left: true, right: true, bottom: true });
    key({ ctrlKey: true, key: '\\', code: 'Backslash' });
    expect(collapsed()).toEqual({ left: false, right: true, bottom: true });
    // всё свёрнуто вручную: «Только схема» разворачивает все панели
    key({ ctrlKey: true, key: 'b', code: 'KeyB' });
    expect(collapsed()).toEqual({ left: true, right: true, bottom: true });
    key({ ctrlKey: true, key: '\\', code: 'Backslash' });
    expect(collapsed()).toEqual({ left: false, right: false, bottom: false });
  });

  it('Ctrl+B в поле ввода не сворачивает панель и не перехватывается', () => {
    render(<App client={client} projectId="p-1" canvas={<input aria-label="поле" />} />);
    const ev = new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true });
    screen.getByLabelText('поле').dispatchEvent(ev);
    expect(collapsed().left).toBe(false);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('команды палитры переключают панели', () => {
    render(<App client={client} projectId="p-1" canvas={<div>холст</div>} />);
    act(() => void findCommand('layout.toggleRight')?.run());
    expect(collapsed().right).toBe(true);
    act(() => void findCommand('layout.canvasOnly')?.run());
    expect(collapsed()).toEqual({ left: true, right: true, bottom: true });
  });

  it('showPanel разворачивает свёрнутую панель: проблема/поле → анализ, запуск → низ', () => {
    render(<App client={client} projectId="p-1" canvas={<div>холст</div>} />);
    act(() => useLayoutStore.getState().toggleCanvasOnly());
    expect(collapsed()).toEqual({ left: true, right: true, bottom: true });
    act(() => useAppStore.getState().showPanel('right', 'structure.props'));
    expect(collapsed()).toEqual({ left: true, right: false, bottom: true });
    act(() => useAppStore.getState().showPanel('bottom', 'bottom.tests'));
    expect(collapsed()).toEqual({ left: true, right: false, bottom: false });
    expect(screen.queryByRole('button', { name: /Развернуть панель/ })).toBeInTheDocument(); // дерево всё ещё свёрнуто
  });

  it('«Консоль»: без запуска — подсказка, после запуска — вывод программы', () => {
    render(<App client={client} projectId="p-1" canvas={<div>холст</div>} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Консоль' }));
    expect(screen.getByTestId('panel-stub')).toHaveTextContent('Нажмите ▶ Запуск — здесь появится вывод программы');
    expect(screen.queryByText(/FE-\d+/)).not.toBeInTheDocument();
    act(() => useTestsStore.getState().showRunResult(runJson));
    expect(screen.queryByTestId('panel-stub')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Результат запуска')).toBeInTheDocument();
  });
});
