import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import umlJson from '@contract/fixtures/uml.demo.json';
import treeJson from '@contract/fixtures/tree.json';
import { resetAppState, useAppStore } from '../../app/store';
import { fixtures } from '../../mocks/fixtures';
import { scenarios } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { createApiClient, resetMethodBlocks, type Schemas } from '../api';
import { CANVAS_METHOD_TAB } from '../layout';
import { resetStructureState, resetTreeState, STRUCTURE_PANEL_ID, useStructureStore, useTreeStore } from '../project-tree';
import { layoutDiagram } from './diagramLayout';
import { resetDiagrams } from './diagramsStore';
import { FLY_MS, goToClass, goToMethod } from './navigation';
import { umlToGraph } from './umlGraph';
import { UmlView } from './UmlView';
import styles from './Diagrams.module.css';

const uml = umlJson as unknown as Schemas['UmlDiagram'];
const client = createApiClient('http://localhost/api');

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

beforeEach(() => {
  resetAppState();
  resetDiagrams();
  resetTreeState();
  resetStructureState();
  resetMethodBlocks();
});

const tree = treeJson as unknown as Schemas['ProjectTree'];
const ORDER_SERVICE = 'com.demo.service.OrderService';

function loadTree() {
  useTreeStore.setState({ projectId: 'p-1', state: { kind: 'ok', tree } });
}

describe('переход диаграмма → редактор (общий выбор класса FE-10)', () => {
  it('класс: выбран в дереве, «Свойства» и «Код Java» открыты, проблема снята; нет в дереве — false', () => {
    useAppStore.getState().openProject('p-1', 1);
    loadTree();
    useAppStore.getState().selectIssue({ issueId: 'ISSUE-7' });
    expect(goToClass(ORDER_SERVICE)).toBe(true);
    const st = useStructureStore.getState();
    expect(st.selection).toEqual({ kind: 'class', ref: { path: 'src/com/demo/service/OrderService.java', name: 'OrderService' } });
    expect(st.selectSeq).toBe(1);
    const s = useAppStore.getState();
    expect(s.selectedIssueId).toBeNull();
    expect(s.activePanels.right).toBe(STRUCTURE_PANEL_ID);
    expect(s.activePanels.bottom).toBe('bottom.code');
    expect(goToClass(ORDER_SERVICE)).toBe(true);
    expect(useStructureStore.getState().selectSeq).toBe(2);
    expect(goToClass('com.demo.Nope')).toBe(false);
  });

  it('метод: selectedMethodId = UmlMember.id, холст — схема метода, выбор класса снят', () => {
    useAppStore.getState().openProject('p-1', 1);
    loadTree();
    goToClass(ORDER_SERVICE);
    useAppStore.getState().showPanel('canvas', 'canvas.uml');
    goToMethod(`${ORDER_SERVICE}.merge~0`);
    const s = useAppStore.getState();
    expect(s.selectedMethodId).toBe(`${ORDER_SERVICE}.merge~0`);
    expect(useStructureStore.getState().selection).toBeNull();
    expect(s.activePanels.canvas).toBe(CANVAS_METHOD_TAB);
    expect(s.activePanels.bottom).toBe('bottom.code');
  });
});

describe('UmlView (MSW, uml.demo.json)', () => {
  it('ELK раскладывает карточки фикстуры без перекрытий', async () => {
    const g = umlToGraph(uml);
    const layout = await layoutDiagram(g.nodes, g.edges);
    const boxes = g.nodes.map((n) => ({ ...n, ...(layout.positions.get(n.id) ?? { x: NaN, y: NaN }) }));
    for (const a of boxes) {
      expect(Number.isFinite(a.x)).toBe(true);
      for (const b of boxes) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
    expect(layout.routes.size).toBe(g.edges.length);
  }, 15_000);

  it('рисует карточки, клик по классу → общий выбор класса, клик по методу → схема метода', async () => {
    useAppStore.getState().openProject('p-1', 1);
    loadTree();
    render(<UmlView client={client} />);
    const cards = await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    expect(cards).toHaveLength(uml.classes.length);

    const main = cards.find((c) => c.dataset.classId === 'com.demo.Main');
    if (!main) throw new Error('нет карточки Main');
    expect(within(main).getByText('Main')).toBeInTheDocument();
    expect(within(main).getByText('com.demo')).toBeInTheDocument();
    // По умолчанию карточка свёрнута: членов нет, стереотипа-текста нет.
    expect(main.querySelector('[data-member-id]')).toBeNull();
    expect(within(main).queryByText(/«/)).toBeNull();
    // Шеврон разворачивает: методы `name()`, private скрыты до «ещё N private».
    fireEvent.click(within(main).getByRole('button', { name: 'Развернуть Main' }));
    await waitFor(() => expect(within(main).getByText('main()')).toBeInTheDocument());
    expect(within(main).queryByText('catalog')).toBeNull();
    expect(within(main).queryByText('handle()')).toBeNull();
    fireEvent.click(within(main).getByRole('button', { name: /ещё \d+ private/ }));
    await waitFor(() => expect(within(main).getByText('catalog')).toBeInTheDocument());
    expect(within(main).getByText('handle()')).toBeInTheDocument();
    expect(within(main).getAllByLabelText('private').length).toBeGreaterThan(0);
    // Рёбра в jsdom не рисуются — нет размеров нод; их данные проверяет umlGraph.test.ts.

    const order = cards.find((c) => c.dataset.classId === ORDER_SERVICE);
    if (!order) throw new Error('нет карточки OrderService');
    fireEvent.click(within(order).getByTitle(/OrderService — открыть в редакторе/));
    await waitFor(() => expect(useStructureStore.getState().selection?.ref.name).toBe('OrderService'), { timeout: 3000 });
    expect(useAppStore.getState().activePanels.right).toBe(STRUCTURE_PANEL_ID);
    // Выбранная карточка подсвечена (общий выбор → FQN).
    await waitFor(() => expect(order.className).toContain(styles.cardSelected));

    const method = main.querySelector('[data-member-id="com.demo.Main.main~0"]');
    if (!method) throw new Error('нет метода main');
    fireEvent.click(method);
    await waitFor(() => expect(useAppStore.getState().selectedMethodId).toBe('com.demo.Main.main~0'), { timeout: 3000 });
    expect(useAppStore.getState().activePanels.canvas).toBe(CANVAS_METHOD_TAB);
  }, 20_000);

  it('уход со вкладки во время «полёта» отменяет переход: выбор класса не меняется', async () => {
    useAppStore.getState().openProject('p-1', 1);
    loadTree();
    const { unmount } = render(<UmlView client={client} />);
    const cards = await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    const order = cards.find((c) => c.dataset.classId === ORDER_SERVICE);
    if (!order) throw new Error('нет карточки OrderService');
    fireEvent.click(within(order).getByTitle(/OrderService — открыть в редакторе/));
    unmount();
    await new Promise((r) => setTimeout(r, FLY_MS + 400));
    expect(useStructureStore.getState().selection).toBeNull();
    expect(useAppStore.getState().activePanels.right).not.toBe(STRUCTURE_PANEL_ID);
  }, 20_000);

  it('Enter в поиске во время полёта по клику не отменяет переход в редактор', async () => {
    useAppStore.getState().openProject('p-1', 1);
    loadTree();
    render(<UmlView client={client} />);
    const cards = await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    const order = cards.find((c) => c.dataset.classId === ORDER_SERVICE);
    if (!order) throw new Error('нет карточки OrderService');
    fireEvent.click(within(order).getByTitle(/OrderService — открыть в редакторе/));
    const search = screen.getByLabelText('Найти класс…');
    fireEvent.change(search, { target: { value: 'main' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(useStructureStore.getState().selection?.ref.name).toBe('OrderService'), { timeout: 3000 });
  }, 20_000);

  it('клик по методу: GET blocks уходит сразу, параллельно с «полётом» (до перехода на холст)', async () => {
    let blocksCalls = 0;
    server.use(
      http.get('*/api/projects/:projectId/methods/:methodId/blocks', () => {
        blocksCalls++;
        return HttpResponse.json(fixtures.methodViewMerge);
      }),
    );
    useAppStore.getState().openProject('p-1', 1);
    loadTree();
    render(<UmlView client={client} />);
    await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть все' }));
    await waitFor(() => expect(document.querySelector('[data-member-id="com.demo.service.OrderService.merge~0"]')).not.toBeNull());
    const method = document.querySelector('[data-member-id="com.demo.service.OrderService.merge~0"]');
    if (!method) throw new Error('нет метода merge');
    fireEvent.click(method);
    await waitFor(() => expect(blocksCalls).toBe(1), { timeout: 400 });
    expect(useAppStore.getState().selectedMethodId).toBeNull();
    await waitFor(() => expect(useAppStore.getState().selectedMethodId).toBe('com.demo.service.OrderService.merge~0'), { timeout: 3000 });
  }, 20_000);

  it('«Развернуть все» / «Свернуть все»: члены всех карточек, конструкторы не показываются', async () => {
    useAppStore.getState().openProject('p-1', 1);
    render(<UmlView client={client} />);
    await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    expect(document.querySelector('[data-member-id]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть все' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Свернуть все' })).toBeInTheDocument());
    await waitFor(() => expect(document.querySelectorAll('[data-member-id]').length).toBeGreaterThan(uml.classes.length));
    expect(document.querySelector('[data-member-id*="<init>"]')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Свернуть / }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть все' }));
    await waitFor(() => expect(document.querySelector('[data-member-id]')).toBeNull());
    expect(screen.getByRole('button', { name: 'Развернуть все' })).toBeInTheDocument();
  }, 20_000);

  it('шеврон разворачивает только свою карточку; список членов прокручивается колесом (nowheel), не зумит холст', async () => {
    useAppStore.getState().openProject('p-1', 1);
    render(<UmlView client={client} />);
    const cards = await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    const order = cards.find((c) => c.dataset.classId === ORDER_SERVICE);
    if (!order) throw new Error('нет карточки OrderService');
    fireEvent.click(within(order).getByRole('button', { name: 'Развернуть OrderService' }));
    const list = await within(order).findByTestId('uml-members');
    expect(list.className).toContain('nowheel');
    expect(list.className).toContain(styles.cardBody);
    expect(screen.getAllByTestId('uml-members')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Развернуть все' })).toBeInTheDocument();
  }, 20_000);

  it('«Все связи»: по умолчанию выключено, переключение не пересоздаёт холст', async () => {
    useAppStore.getState().openProject('p-1', 1);
    render(<UmlView client={client} />);
    await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    const canvas = screen.getByTestId('uml-canvas');
    const toggle = screen.getByRole('button', { name: 'Все связи' });
    expect(toggle).toHaveAttribute('title', 'Показать слабые связи „использует“');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getAllByTestId('uml-class')).toHaveLength(uml.classes.length));
    expect(screen.getByTestId('uml-canvas')).toBe(canvas);
  }, 20_000);

  it('поиск: число найденных; смена версии проекта перезагружает диаграмму', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/projects/:projectId/uml', () => {
        calls++;
        return HttpResponse.json(uml);
      }),
    );
    useAppStore.getState().openProject('p-1', 1);
    render(<UmlView client={client} />);
    await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    fireEvent.change(screen.getByLabelText('Найти класс…'), { target: { value: 'order' } });
    expect(screen.getByText(/найдено: \d+/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Найти класс…'), { target: { value: 'zzz' } });
    expect(screen.getByText('не найдено')).toBeInTheDocument();
    expect(calls).toBe(1);
    act(() => useAppStore.getState().setVersion(2));
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getAllByTestId('uml-class')).toHaveLength(uml.classes.length);
  }, 20_000);

  it('демо без циклов: панели циклов нет, карточки не красные', async () => {
    useAppStore.getState().openProject('p-1', 1);
    render(<UmlView client={client} />);
    await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    // Граф зависимостей грузится параллельно: дождаться ответа, затем проверить.
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByTestId('cycle-list')).toBeNull();
    expect(document.querySelector('[data-in-cycle]')).toBeNull();
  }, 20_000);

  it('ошибка загрузки — сообщение', async () => {
    server.use(http.get('*/api/projects/:projectId/uml', () => HttpResponse.json({ code: 'NOT_FOUND', message: 'нет проекта' }, { status: 404 })));
    useAppStore.getState().openProject('p-1', 1);
    render(<UmlView client={client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('нет проекта');
  });
});

describe('UmlView — циклы зависимостей (dependencies.cycle.json, FE-48)', () => {
  const CART = 'com.shop.Cart';
  const PRICING = 'com.shop.Pricing';
  const ITEM = 'com.shop.Item';
  const card = (id: string) => document.querySelector<HTMLElement>(`[data-testid="uml-class"][data-class-id="${id}"]`);

  it('классы цикла красные, панель «Циклы (N)»: наведение выделяет цикл, клик → Issue и подсветка цикла', async () => {
    server.use(scenarios.umlCycle, scenarios.dependenciesCycle);
    useAppStore.getState().openProject('p-1', 2);
    render(<UmlView client={client} />);
    const list = await screen.findByTestId('cycle-list', {}, { timeout: 10_000 });
    expect(screen.getAllByTestId('uml-class')).toHaveLength(3);
    await waitFor(() => expect(card(CART)?.className).toContain(styles.cardCycle));
    expect(card(PRICING)?.className).toContain(styles.cardCycle);
    expect(card(PRICING)).toHaveAttribute('data-in-cycle', 'true');
    expect(card(ITEM)?.className).not.toContain(styles.cardCycle);

    expect(screen.getByRole('button', { name: 'Все связи' })).toHaveAttribute('aria-pressed', 'false');
    // Ассоциация Cart → Pricing — та же связь, но красная; зависимость Pricing → Cart (обычно скрыта) — видна и красная.
    expect(screen.getByRole('button', { name: 'Все связи' })).toHaveAttribute('aria-pressed', 'false');
    // Рёбра в jsdom не рисуются (нет замера handle): цвет и видимость рёбер цикла — в umlGraph.test.ts.

    // Панель «Циклы (N)»: наведение выделяет классы цикла, клик → Issue CyclicDependency.
    expect(within(list).getByText('Циклы (1)')).toBeInTheDocument();
    const item = within(list).getByRole('button', { name: /Cart → Pricing → Cart/ });
    fireEvent.mouseEnter(item);
    expect(card(CART)?.className).toContain(styles.cardMatch);
    expect(card(ITEM)?.className).toContain(styles.cardDim);
    fireEvent.mouseLeave(item);
    expect(card(ITEM)?.className).not.toContain(styles.cardDim);
    fireEvent.click(item);
    const s = useAppStore.getState();
    expect(s.selectedIssueId).toBe('ISSUE-7');
    expect(s.selectedBlockId).toBeNull();
    expect(s.activePanels.right).toBe('analysis.problems');
    expect(s.activePanels.bottom).toBe('bottom.code');
    // Цикл выбранной проблемы подсвечен, пункт панели отмечен.
    await waitFor(() => expect(card(ITEM)?.className).toContain(styles.cardDim));
    expect(item).toHaveAttribute('aria-current', 'true');
    // Снятие выбора проблемы снимает подсветку.
    act(() => useAppStore.getState().selectIssue(null));
    await waitFor(() => expect(card(ITEM)?.className).not.toContain(styles.cardDim));
  }, 20_000);

  it('граф зависимостей не загрузился — UML без циклов', async () => {
    server.use(
      scenarios.umlCycle,
      http.get('*/api/projects/:projectId/dependencies', () => HttpResponse.json({ code: 'INTERNAL', message: 'сбой' }, { status: 500 })),
    );
    useAppStore.getState().openProject('p-1', 2);
    render(<UmlView client={client} />);
    await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByTestId('cycle-list')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('[data-in-cycle]')).toBeNull();
  }, 20_000);
});
