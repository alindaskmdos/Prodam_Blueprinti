import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import treeJson from '@contract/fixtures/tree.json';
import fileJson from '@contract/fixtures/file.order-service.json';
import { createApiClient } from '../features/api';
import { resetAnalysisState, useAnalysisStore } from '../features/analysis-panel';
import type { MonacoViewProps } from '../features/editor-code/MonacoView';
import { resetTreeState } from '../features/project-tree';
import { server } from '../mocks/server';
import { fixtures } from '../mocks/fixtures';
import { App } from './App';
import { resetAppState, useAppStore } from './store';

// Monaco в jsdom не работает — подменяем представление textarea (как в CodeEditor.test.tsx).
vi.mock('../features/editor-code/MonacoView', async () => {
  const { useEffect, useState } = await import('react');
  function FakeMonaco({ text, loadSeq, onChange, reveal }: MonacoViewProps) {
    const [value, setValue] = useState(text);
    useEffect(() => setValue(text), [text, loadSeq]);
    // Сколько раз пришла новая подсветка с прокруткой (смена seq/диапазона) — для проверки «без повторных прокруток».
    const [reveals, setReveals] = useState(0);
    useEffect(() => {
      if (reveal) setReveals((n) => n + 1);
    }, [reveal?.seq, reveal?.startLine, reveal?.endLine]); // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <textarea
        aria-label="код"
        data-reveal={reveal ? `${reveal.startLine}-${reveal.endLine}` : ''}
        data-reveals={reveals}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChange(e.target.value);
        }}
      />
    );
  }
  return { default: FakeMonaco };
});

// React Flow в jsdom требует ResizeObserver и DOMMatrixReadOnly.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= class {
    m22 = 1;
  };
});

const API = '*/api';

const client = createApiClient('http://localhost/api');
const merge = treeJson.packages[0]?.files[0]?.classes[0]?.methods[0];
if (!merge) throw new Error('в tree.json нет метода');

describe('App — каркас редактора на MSW', () => {
  beforeEach(() => {
    resetAppState();
    resetTreeState();
    resetAnalysisState();
  });
  afterEach(() => {
    server.events.removeAllListeners();
    vi.restoreAllMocks();
  });

  it('рендерит шапку, дерево из tree.json, холст и обе панели вкладок', async () => {
    render(<App client={client} projectId="p-1" />);

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
    render(<App client={client} projectId="p-1" />);

    const button = await screen.findByRole('button', { name: new RegExp(merge.name) });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);

    expect(useAppStore.getState().selectedMethodId).toBe(merge.id);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('canvas-method')).toHaveTextContent('OrderService.merge');
  });

  it('слот холста подставляет переданный компонент', async () => {
    render(<App client={client} projectId="p-1" canvas={<div>холст FE-03</div>} />);
    expect(await screen.findByText('OrderService')).toBeInTheDocument();
    expect(screen.getByText('холст FE-03')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas-stub')).not.toBeInTheDocument();
  });

  it('выбор метода → холст рисует ноды метода из method-view.merge.json', async () => {
    render(<App client={client} projectId="p-1" />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(merge.name) }));

    expect(await screen.findByTestId('node-method', {}, { timeout: 10_000 })).toHaveTextContent('public int merge()');
    expect(screen.getAllByTestId('container-for')).toHaveLength(2);
    expect(screen.getByTestId('node-return')).toHaveTextContent('return merged');
    expect(screen.queryByTestId('canvas-stub')).not.toBeInTheDocument();
  }, 15_000);

  it('вкладка «Код Java»: без метода — подсказка, с методом — текст его файла (file.order-service.json)', async () => {
    render(<App client={client} projectId="p-1" />);
    expect(screen.getByText(/здесь откроется код его файла/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(merge.name) }));
    const area = await screen.findByLabelText('код');
    expect(area).toHaveValue(fileJson.text);
    expect((area as HTMLTextAreaElement).value).toContain('public class OrderService');
    expect(screen.getByRole('region', { name: `Код ${fileJson.path}` })).toBeInTheDocument();
  });

  it('выбор метода → код прокручивается к span метода; правка не прокручивает заново (FE-35)', async () => {
    render(<App client={client} projectId="p-1" />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(merge.name) }));
    const area = await screen.findByLabelText('код');
    const span = fixtures.methodViewMerge.root.span;
    await waitFor(() => expect(area).toHaveAttribute('data-reveal', `${span?.startLine}-${span?.endLine}`));
    expect(area).toHaveAttribute('data-reveals', '1');

    fireEvent.change(area, { target: { value: `${fileJson.text}\n// правка` } });
    await waitFor(() => expect(useAppStore.getState().version).toBe(treeJson.version + 1), { timeout: 3000 });
    await screen.findByText(new RegExp(`версия ${treeJson.version + 1}`));
    // Правка сдвигает строки: подсветка по старым строкам снимается, прокрутки нет.
    expect(area).toHaveAttribute('data-reveal', '');
    expect(area).toHaveAttribute('data-reveals', '1');
  });

  it('span пришёл раньше текста файла → прокрутка применяется, когда редактор открылся (FE-35)', async () => {
    server.use(
      http.get(`${API}/projects/:projectId/files`, async () => {
        await delay(300);
        return HttpResponse.json(fileJson);
      }),
    );
    render(<App client={client} projectId="p-1" />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(merge.name) }));
    const area = await screen.findByLabelText('код');
    const span = fixtures.methodViewMerge.root.span;
    await waitFor(() => expect(area).toHaveAttribute('data-reveal', `${span?.startLine}-${span?.endLine}`));
    expect(area).toHaveAttribute('data-reveals', '1');
  });

  it('повторный клик по уже выбранному методу снова прокручивает к его началу (FE-35)', async () => {
    render(<App client={client} projectId="p-1" />);
    const button = await screen.findByRole('button', { name: new RegExp(merge.name) });
    fireEvent.click(button);
    const area = await screen.findByLabelText('код');
    await waitFor(() => expect(area).toHaveAttribute('data-reveals', '1'));
    fireEvent.click(button);
    await waitFor(() => expect(area).toHaveAttribute('data-reveals', '2'));
  });

  it('поздний span после выбора проблемы не применяется и не прыгает при снятии выбора (FE-35)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let answered = false;
    server.use(
      http.get(`${API}/projects/:projectId/methods/:methodId/blocks`, async () => {
        await gate;
        answered = true;
        return HttpResponse.json(fixtures.methodViewMerge);
      }),
    );
    render(<App client={client} projectId="p-1" />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(merge.name) }));
    const area = await screen.findByLabelText('код');
    act(() => useAppStore.getState().selectIssue({ issueId: 'ISSUE-1', methodId: merge.id, blockId: 'b' }));
    release();
    await waitFor(() => expect(answered).toBe(true));
    await act(async () => {
      await delay(50); // ответ GET blocks доходит до хука
    });
    const before = area.getAttribute('data-reveals');
    act(() => useAppStore.getState().selectIssue(null));
    // Снятие проблемы убирает подсветку; к началу метода код не прыгает.
    expect(area).toHaveAttribute('data-reveal', '');
    expect(area).toHaveAttribute('data-reveals', before ?? '');
  });

  it('у метода нет span в данных бэка → код не прокручивается и не подсвечивается (FE-35)', async () => {
    let answered = 0;
    server.use(
      http.get(`${API}/projects/:projectId/methods/:methodId/blocks`, () => {
        answered++;
        return HttpResponse.json({
          ...fixtures.methodViewMerge,
          root: { ...fixtures.methodViewMerge.root, span: undefined },
        });
      }),
    );
    render(<App client={client} projectId="p-1" />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(merge.name) }));
    const area = await screen.findByLabelText('код');
    await waitFor(() => expect(answered).toBeGreaterThanOrEqual(2)); // холст + span метода
    await act(async () => {
      await delay(0);
    });
    expect(area).toHaveAttribute('data-reveal', '');
    expect(area).toHaveAttribute('data-reveals', '0');
  });

  it('правка кода → PUT files, версия растёт, дерево, холст и анализ перезагружаются', async () => {
    const calls = { tree: 0, analysis: 0, blocks: 0 };
    server.use(
      http.get(`${API}/projects/:projectId/tree`, () => {
        calls.tree++;
        return HttpResponse.json(fixtures.tree);
      }),
      http.get(`${API}/projects/:projectId/analysis`, () => {
        calls.analysis++;
        return HttpResponse.json(fixtures.analysisMerge);
      }),
      http.get(`${API}/projects/:projectId/methods/:methodId/blocks`, () => {
        calls.blocks++;
        return HttpResponse.json(fixtures.methodViewMerge);
      }),
    );
    render(<App client={client} projectId="p-1" />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(merge.name) }));
    const area = await screen.findByLabelText('код');
    await waitFor(() => expect(calls.analysis).toBeGreaterThan(0));
    // GET blocks: холст + span метода для прокрутки кода (FE-35).
    await waitFor(() => expect(calls.blocks).toBe(2));
    expect(calls.tree).toBe(1);
    const analysisBefore = calls.analysis;

    fireEvent.change(area, { target: { value: `${fileJson.text}\n// правка` } });
    await waitFor(() => expect(useAppStore.getState().version).toBe(treeJson.version + 1), { timeout: 3000 });
    expect(await screen.findByText(new RegExp(`версия ${treeJson.version + 1}`))).toBeInTheDocument();
    await waitFor(() => expect(calls.tree).toBe(2));
    await waitFor(() => expect(calls.blocks).toBe(3));
    await waitFor(() => expect(calls.analysis).toBeGreaterThan(analysisBefore));
    // Ответ tree.json со старой версией не откатывает версию назад.
    expect(useAppStore.getState().version).toBe(treeJson.version + 1);
  });

  it('409 на PUT files → дерево проекта перезагружается', async () => {
    let treeCalls = 0;
    server.use(
      http.get(`${API}/projects/:projectId/tree`, () => {
        treeCalls++;
        return HttpResponse.json(fixtures.tree);
      }),
      http.put(`${API}/projects/:projectId/files`, () => HttpResponse.json(fixtures.errorConflict, { status: 409 })),
    );
    render(<App client={client} projectId="p-1" />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(merge.name) }));
    const area = await screen.findByLabelText('код');
    expect(treeCalls).toBe(1);

    fireEvent.change(area, { target: { value: 'class X {}' } });
    expect(await screen.findByText('Проект изменён', {}, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(treeCalls).toBe(2));
  });

  it('своя правка ноды → PUT blocks без лишнего GET blocks; анализ из ответа, дерево перезагружается', async () => {
    const calls = { tree: 0, blocks: 0, putBlocks: 0 };
    server.use(
      http.get(`${API}/projects/:projectId/tree`, () => {
        calls.tree++;
        return HttpResponse.json(fixtures.tree);
      }),
      http.get(`${API}/projects/:projectId/methods/:methodId/blocks`, () => {
        calls.blocks++;
        return HttpResponse.json(fixtures.methodViewMerge);
      }),
    );
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT' && request.url.includes('/blocks')) calls.putBlocks++;
    });
    const setAnalysis = vi.spyOn(useAnalysisStore.getState(), 'setAnalysis');
    render(<App client={client} projectId="p-1" />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(merge.name) }));
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    const node = screen.getAllByTestId('node-var').find((n) => n.textContent?.includes('a = orders.get(i)'));
    if (!node) throw new Error('нет ноды var a');
    // 2 = холст + span метода для прокрутки кода (FE-35); после правки ноды лишних GET нет.
    expect(calls.blocks).toBe(2);
    expect(calls.tree).toBe(1);

    fireEvent.doubleClick(within(node).getByText((_, el) => el?.tagName === 'PRE'));
    const init = within(node).getByLabelText('=');
    fireEvent.change(init, { target: { value: 'new Order()' } });
    fireEvent.keyDown(init, { key: 'Enter' });

    await waitFor(() => expect(useAppStore.getState().version).toBe(treeJson.version + 1));
    await waitFor(() => expect(calls.tree).toBe(2));
    expect(setAnalysis).toHaveBeenCalledWith('p-1', fixtures.analysisMerge);
    expect(
      await screen.findByText((_, el) => el?.tagName === 'PRE' && el.textContent === 'Order a = new Order()'),
    ).toBeInTheDocument();
    expect(calls.putBlocks).toBe(1);
    expect(calls.blocks).toBe(2);
  }, 15_000);
});
