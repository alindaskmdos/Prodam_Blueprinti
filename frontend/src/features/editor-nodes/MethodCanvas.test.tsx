import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState, useAppStore } from '../../app/store';
import { scenarios } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { createApiClient, type Schemas } from '../api';
import { MethodCanvas } from './index';
import styles from './MethodCanvas.module.css';

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

const client = createApiClient('http://localhost/api');
const methodId = 'com.demo.service.OrderService.merge~0';

describe('MethodCanvas', () => {
  it('загружает метод через GET blocks (моки fixtures) и рисует ноды и контейнеры', async () => {
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    expect(screen.getByText('Загрузка метода…')).toBeInTheDocument();

    expect(await screen.findByTestId('node-method', {}, { timeout: 10_000 })).toHaveTextContent('public int merge()');
    expect(screen.getByText('O(n²)')).toBeInTheDocument();
    expect(screen.getAllByTestId('container-for')).toHaveLength(2);
    expect(screen.getAllByTestId('container-if')).toHaveLength(2);
    expect(screen.getAllByTestId('node-expr')).toHaveLength(4);
    expect(screen.getByTestId('node-return')).toHaveTextContent('return merged');
    expect(screen.getByTestId('node-continue')).toBeInTheDocument();
  }, 15_000);

  it('ошибка загрузки показывается сообщением', async () => {
    server.use(
      http.get('*/api/projects/:projectId/methods/:methodId/blocks', () =>
        HttpResponse.json({ code: 'NOT_FOUND', message: 'метод не найден' }, { status: 404 }),
      ),
    );
    render(<MethodCanvas projectId="p-1" methodId="nope" client={client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('метод не найден');
  });
});

describe('MethodCanvas — правка текста в ноде (FE-07)', () => {
  beforeEach(() => {
    resetAppState();
    useAppStore.getState().openProject('p-1', 7);
  });

  /** Нода var «Order a = orders.get(i)». */
  async function varNode(): Promise<HTMLElement> {
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    const node = screen.getAllByTestId('node-var').find((n) => n.textContent?.includes('a = orders.get(i)'));
    if (!node) throw new Error('нет ноды var a');
    return node;
  }

  function bodies(): { version: number; root: unknown }[] {
    const got: { version: number; root: unknown }[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT') void request.clone().json().then((b) => got.push(b as never));
    });
    return got;
  }

  afterEach(() => server.events.removeAllListeners());

  it('двойной клик → редактор с подсветкой; Enter → PUT с версией из стора; 200 → новый текст и версия', async () => {
    const sent = bodies();
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    const node = await varNode();

    fireEvent.doubleClick(within(node).getByText((_, el) => el?.tagName === 'PRE'));
    const editor = within(node).getByTestId('node-editor');
    // Фокус в первом поле; у var поля тип / имя / значение.
    expect(within(editor).getByLabelText('тип')).toHaveFocus();
    const init = within(editor).getByLabelText('=');
    // Слой подсветки (pre) лежит рядом с textarea и показывает тот же текст.
    expect(init.previousElementSibling).toHaveTextContent('orders.get(i)');

    fireEvent.change(init, { target: { value: 'new Order()' } });
    expect(within(editor).getByText('new')).toHaveClass(styles.tok_keyword ?? 'tok_keyword');
    fireEvent.keyDown(init, { key: 'Enter' });

    await waitFor(() => expect(useAppStore.getState().version).toBe(8));
    expect(sent[0]?.version).toBe(7);
    await waitFor(() => expect(screen.queryByTestId('node-editor')).not.toBeInTheDocument());
    expect(await screen.findByText((_, el) => el?.tagName === 'PRE' && el.textContent === 'Order a = new Order()')).toBeInTheDocument();
  }, 15_000);

  it('422 → нода красная с введённым текстом и сообщением; «Отменить правку» возвращает текст', async () => {
    server.use(scenarios.parseErrorOnBlocks);
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    const node = await varNode();

    fireEvent.click(within(node).getByRole('button', { name: /Править/ }));
    const init = within(node).getByLabelText('=');
    fireEvent.change(init, { target: { value: 'orders.get(i) ==' } });
    fireEvent.keyDown(init, { key: 'Enter' });

    const alert = await screen.findByText(/Синтаксическая ошибка.*В код не попало/, {}, { timeout: 10_000 });
    const red = alert.closest('[data-testid="node-var"]') as HTMLElement;
    expect(red).toHaveAttribute('data-invalid', 'true');
    expect(red).toHaveTextContent('Order a = orders.get(i) ==');
    expect(red).toHaveTextContent('Переменная · ошибка');
    expect(useAppStore.getState().version).toBe(7);

    fireEvent.click(within(red).getByRole('button', { name: 'Отменить правку' }));
    await waitFor(() => expect(screen.queryByText(/В код не попало/)).not.toBeInTheDocument(), { timeout: 10_000 });
    expect(await varNode()).not.toHaveAttribute('data-invalid');
  }, 20_000);

  it('Esc — отмена без запроса', async () => {
    const sent = bodies();
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    const node = await varNode();
    fireEvent.doubleClick(within(node).getByText((_, el) => el?.tagName === 'PRE'));
    const init = within(node).getByLabelText('=');
    fireEvent.change(init, { target: { value: 'zzz' } });
    fireEvent.keyDown(init, { key: 'Escape' });
    expect(screen.queryByTestId('node-editor')).not.toBeInTheDocument();
    expect(node).toHaveTextContent('Order a = orders.get(i)');
    expect(sent).toHaveLength(0);
  }, 15_000);

  it('409 → тост «Проект изменился» и перезагрузка метода', async () => {
    server.use(scenarios.conflictOnBlocks);
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    const node = await varNode();
    fireEvent.doubleClick(within(node).getByText((_, el) => el?.tagName === 'PRE'));
    const init = within(node).getByLabelText('=');
    fireEvent.change(init, { target: { value: 'orders.get(0)' } });
    fireEvent.blur(init);

    expect(await screen.findByText('Проект изменился')).toBeInTheDocument();
    expect(screen.getByText(/версии 2, сейчас 3/)).toBeInTheDocument();
    expect(await varNode()).toHaveTextContent('Order a = orders.get(i)');
  }, 15_000);

  it('версия в сторе выросла при открытом редакторе → пометка «Метод изменился», черновик цел; «Применить к новому» → PUT', async () => {
    const sent = bodies();
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    const node = await varNode();
    fireEvent.doubleClick(within(node).getByText((_, el) => el?.tagName === 'PRE'));
    const init = within(node).getByLabelText('=');
    fireEvent.change(init, { target: { value: 'orders.get(5)' } });

    act(() => useAppStore.getState().setVersion(12));
    expect(await within(node).findByText(/Метод изменился/)).toBeInTheDocument();
    fireEvent.blur(init);
    expect(within(node).getByLabelText('=')).toHaveValue('orders.get(5)');
    expect(sent).toHaveLength(0);

    fireEvent.click(within(node).getByRole('button', { name: 'Применить к новому' }));
    await waitFor(() => expect(useAppStore.getState().version).toBe(13));
    expect(sent[0]?.version).toBe(12);
  }, 15_000);
});

describe('MethodCanvas — вставка, удаление, вверх/вниз (FE-08)', () => {
  beforeEach(() => {
    resetAppState();
    useAppStore.getState().openProject('p-1', 7);
  });
  afterEach(() => {
    server.events.removeAllListeners();
    vi.restoreAllMocks();
  });

  function bodies(): { version: number; root: Schemas['Block'] }[] {
    const got: { version: number; root: Schemas['Block'] }[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT') void request.clone().json().then((b) => got.push(b as never));
    });
    return got;
  }

  const plus = (point: string) => {
    const btn = document.querySelector(`[data-insert="${point}"]`);
    if (!(btn instanceof HTMLElement)) throw new Error(`нет «+» ${point}`);
    return btn;
  };

  it('«+» в конце метода → меню kind → нода с редактором → Enter → PUT с новым блоком', async () => {
    const sent = bodies();
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });

    fireEvent.click(plus('root/body/3'));
    const menu = screen.getByRole('menu', { name: 'Вставить блок' });
    expect(within(menu).queryByText('case')).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Вызов метода/ }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    const editor = await screen.findByTestId('node-editor', {}, { timeout: 10_000 });
    const field = within(editor).getByLabelText('выражение');
    expect(field).toHaveFocus();
    expect(sent).toHaveLength(0);
    fireEvent.change(field, { target: { value: 'log(merged)' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(useAppStore.getState().version).toBe(8));
    expect(sent[0]?.root.slots.body?.[3]).toEqual({ id: '', kind: 'expr', fields: { text: 'log(merged)' }, slots: {} });
    expect(await screen.findByText((_, el) => el?.tagName === 'PRE' && el.textContent === 'log(merged)')).toBeInTheDocument();
  }, 20_000);

  describe('палитра и drag (FE-09)', () => {
    // Стрелки React Flow в jsdom не рисуются (нет измеренных нод), поэтому через холст проверяем drop на «+»
    // в конце слота — это та же drop-цель, что и стрелка; сама стрелка — в FlowEdge.drop.test.tsx.
    const dt = (kind?: string) => ({ types: [], getData: () => kind ?? '', setData: () => {}, dropEffect: '', effectAllowed: '' });
    const item = (kind: string) => {
      const el = document.querySelector(`[data-testid="palette"] [data-kind="${kind}"]`);
      if (!(el instanceof HTMLElement)) throw new Error(`нет ${kind} в палитре`);
      return el;
    };

    it('палитра с подписями; drop подсвечивает цель и вставляет блок в это место (PUT)', async () => {
      const sent = bodies();
      render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
      await screen.findByTestId('node-method', {}, { timeout: 10_000 });
      expect(item('while')).toHaveAttribute('aria-label', expect.stringContaining('Цикл while'));
      expect(item('while')).toHaveAttribute('title');
      expect(item('while')).toHaveAttribute('draggable', 'true');

      fireEvent.dragStart(item('break'), { dataTransfer: dt() });
      const target = plus('root/body/3');
      fireEvent.dragOver(target, { dataTransfer: dt() });
      expect(target).toHaveAttribute('data-over');
      fireEvent.drop(target, { dataTransfer: dt('break') });
      expect(target).not.toHaveAttribute('data-over');

      await waitFor(() => expect(useAppStore.getState().version).toBe(8), { timeout: 10_000 });
      expect(sent[0]?.root.slots.body?.[3]).toMatchObject({ id: '', kind: 'break' });
    }, 20_000);

    it('drop мимо цели и чужой drag ничего не вставляют', async () => {
      const sent = bodies();
      render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
      await screen.findByTestId('node-method', {}, { timeout: 10_000 });
      const nodes = screen.getAllByTestId('node-expr').length;

      fireEvent.dragStart(item('break'), { dataTransfer: dt() });
      fireEvent.drop(screen.getByTestId('node-method'), { dataTransfer: dt('break') });
      fireEvent.dragEnd(item('break'));
      // Чужой drag (файл, текст) цель не принимает и не подсвечивается.
      const target = plus('root/body/3');
      fireEvent.dragOver(target, { dataTransfer: dt() });
      fireEvent.drop(target, { dataTransfer: dt() });
      expect(target).not.toHaveAttribute('data-over');
      await new Promise((r) => setTimeout(r, 100));
      expect(sent).toHaveLength(0);
      expect(screen.getAllByTestId('node-expr')).toHaveLength(nodes);
      expect(screen.queryByTestId('node-editor')).not.toBeInTheDocument();
    }, 20_000);
  });

  it('Esc в меню закрывает его; Esc в редакторе новой ноды убирает её', async () => {
    const sent = bodies();
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    const exprs = screen.getAllByTestId('node-expr').length;

    fireEvent.click(plus('root/body/3'));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(plus('root/body/3'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Вызов метода/ }));
    const field = within(await screen.findByTestId('node-editor', {}, { timeout: 10_000 })).getByLabelText('выражение');
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.getAllByTestId('node-expr')).toHaveLength(exprs), { timeout: 10_000 });
    expect(sent).toHaveLength(0);
  }, 20_000);

  it('422 на новую ноду → красная, текст остаётся', async () => {
    server.use(scenarios.parseErrorOnBlocks);
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    fireEvent.click(plus('root/body/3'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Вызов метода/ }));
    const field = within(await screen.findByTestId('node-editor', {}, { timeout: 10_000 })).getByLabelText('выражение');
    fireEvent.change(field, { target: { value: 'foo(' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    const alert = await screen.findByText(/В код не попало/, {}, { timeout: 10_000 });
    const red = alert.closest('[data-testid="node-expr"]') as HTMLElement;
    expect(red).toHaveAttribute('data-invalid', 'true');
    expect(red).toHaveTextContent('foo(');
    expect(useAppStore.getState().version).toBe(7);
  }, 20_000);

  it('✕ на листе — удаление сразу; на контейнере — с подтверждением; отказ — без запроса', async () => {
    const sent = bodies();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    expect(screen.queryByRole('button', { name: 'Удалить: Метод' })).not.toBeInTheDocument();

    const forHead = screen.getAllByTestId('node-for')[0] as HTMLElement;
    fireEvent.click(within(forHead).getByRole('button', { name: /Удалить/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);

    fireEvent.click(within(screen.getByTestId('node-return')).getByRole('button', { name: /Удалить/ }));
    await waitFor(() => expect(useAppStore.getState().version).toBe(8));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent[0]?.root.slots.body?.map((x) => x.kind)).toEqual(['var', 'for']);
    await waitFor(() => expect(screen.queryByTestId('node-return')).not.toBeInTheDocument());
  }, 20_000);

  it('Delete на выделенной ноде — удаление; в поле ввода — нет', async () => {
    const sent = bodies();
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    const ret = screen.getByTestId('node-return');
    fireEvent.click(ret.closest('.react-flow__node') as HTMLElement);
    await waitFor(() => expect(ret.closest('.react-flow__node')).toHaveClass('selected'));
    const input = document.createElement('textarea');
    document.body.append(input);
    fireEvent.keyDown(input, { key: 'Delete' });
    input.remove();
    expect(sent).toHaveLength(0);

    fireEvent.keyDown(document.body, { key: 'Delete' });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.root.slots.body?.map((x) => x.kind)).toEqual(['var', 'for']);
  }, 20_000);

  it('выделение → перестановка кнопкой → Delete не удаляет чужой блок (выделение сброшено)', async () => {
    const sent = bodies();
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    const firstVar = screen.getAllByTestId('node-var').find((n) => n.textContent?.includes('merged = 0')) as HTMLElement;
    fireEvent.click(firstVar.closest('.react-flow__node') as HTMLElement);
    await waitFor(() => expect(firstVar.closest('.react-flow__node')).toHaveClass('selected'));

    fireEvent.click(within(firstVar).getByRole('button', { name: /Ниже/ }));
    await waitFor(() => expect(useAppStore.getState().version).toBe(8));
    await waitFor(() => expect(document.querySelector('.react-flow__node.selected')).toBeNull(), { timeout: 10_000 });
    fireEvent.keyDown(document.body, { key: 'Delete' });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(1);
  }, 20_000);

  it('↑ на первом в слоте недоступна; ↓ → PUT с переставленными блоками', async () => {
    const sent = bodies();
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    const firstVar = screen.getAllByTestId('node-var').find((n) => n.textContent?.includes('merged = 0')) as HTMLElement;
    expect(within(firstVar).getByRole('button', { name: /Выше/ })).toBeDisabled();
    expect(within(screen.getByTestId('node-return')).getByRole('button', { name: /Ниже/ })).toBeDisabled();

    fireEvent.click(within(firstVar).getByRole('button', { name: /Ниже/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.root.slots.body?.map((x) => x.kind)).toEqual(['for', 'var', 'return']);
  }, 20_000);

  it('422 на перестановку → откат с сообщением', async () => {
    server.use(
      http.put('*/api/projects/:projectId/methods/:methodId/blocks', () =>
        HttpResponse.json({ code: 'PARSE_ERROR', message: 'нельзя переставить' }, { status: 422 }),
      ),
    );
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    fireEvent.click(within(screen.getByTestId('node-return')).getByRole('button', { name: /Выше/ }));
    expect(await screen.findByText(/операция не применена: нельзя переставить/)).toBeInTheDocument();
    expect(useAppStore.getState().version).toBe(7);
  }, 20_000);
});

describe('MethodCanvas — подсветка строка ↔ нода, проблема (FE-05)', () => {
  const FILE = 'src/com/demo/service/OrderService.java';
  const wrapper = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
  const HL = styles.lineHighlight ?? 'lineHighlight';
  const PULSE = styles.issuePulse ?? 'issuePulse';

  beforeEach(() => {
    resetAppState();
    useAppStore.getState().openProject('p-1', 7);
    useAppStore.getState().selectMethod(methodId);
  });

  it('курсор в коде (store code) → подсвечена самая глубокая нода строки, в store холст не пишет', async () => {
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    act(() => useAppStore.getState().setHighlight({ source: 'code', span: { file: FILE, startLine: 45, endLine: 45 } }));
    const before = useAppStore.getState().highlight;
    await waitFor(() => expect(wrapper(`${methodId}/body/1/body/2/body/0`)).toHaveClass(HL));
    expect(useAppStore.getState().highlight).toBe(before);

    // Строка заголовка цикла — подсвечивается заголовок контейнера.
    act(() => useAppStore.getState().setHighlight({ source: 'code', span: { file: FILE, startLine: 44, endLine: 44 } }));
    await waitFor(() => expect(wrapper(`${methodId}/body/1/body/2#head`)).toHaveClass(HL));
    expect(wrapper(`${methodId}/body/1/body/2/body/0`)).not.toHaveClass(HL);
  }, 15_000);

  it('клик по ноде → store highlight canvas с id и span блока', async () => {
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    const node = wrapper(`${methodId}/body/0`);
    if (!node) throw new Error('нет ноды body/0');
    fireEvent.click(node);
    expect(useAppStore.getState().highlight).toMatchObject({
      source: 'canvas',
      blockId: `${methodId}/body/0`,
      span: { file: FILE, startLine: 38, endLine: 38 },
    });
    await waitFor(() => expect(wrapper(`${methodId}/body/0`)).toHaveClass(HL));
  }, 15_000);

  it('выбор проблемы → нода пульсирует (контейнер — заголовок); снятие выбора — без пульса', async () => {
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    act(() => useAppStore.getState().selectIssue({ issueId: 'I-1', methodId, blockId: `${methodId}/body/1/body/2` }));
    const head = `${methodId}/body/1/body/2#head`;
    await waitFor(() => expect(wrapper(head)).toHaveClass(PULSE));
    act(() => useAppStore.getState().selectIssue(null));
    await waitFor(() => expect(wrapper(head)).not.toHaveClass(PULSE));
  }, 15_000);
});

describe('MethodCanvas — правка не сбрасывает вид (FE-29)', () => {
  beforeEach(() => {
    resetAppState();
    useAppStore.getState().openProject('p-1', 7);
  });

  it('после правки ноды React Flow не пересоздаётся (viewport сохраняется), «Раскладка схемы…» не появляется', async () => {
    const { container } = render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    const flow = container.querySelector('.react-flow');
    const viewport = container.querySelector('.react-flow__viewport');
    expect(flow).not.toBeNull();
    const node = screen.getAllByTestId('node-var').find((n) => n.textContent?.includes('a = orders.get(i)')) as HTMLElement;

    let pendingSeen = false;
    const observer = new MutationObserver(() => {
      if (screen.queryByText('Раскладка схемы…')) pendingSeen = true;
    });
    observer.observe(container, { childList: true, subtree: true });

    fireEvent.doubleClick(within(node).getByText((_, el) => el?.tagName === 'PRE'));
    const init = within(node).getByLabelText('=');
    fireEvent.change(init, { target: { value: 'new Order()' } });
    fireEvent.keyDown(init, { key: 'Enter' });

    await waitFor(() => expect(useAppStore.getState().version).toBe(8));
    expect(await screen.findByText((_, el) => el?.tagName === 'PRE' && el.textContent === 'Order a = new Order()', {}, { timeout: 10_000 })).toBeInTheDocument();
    observer.disconnect();

    expect(pendingSeen).toBe(false);
    expect(container.querySelector('.react-flow')).toBe(flow);
    expect(container.querySelector('.react-flow__viewport')).toBe(viewport);
  }, 20_000);
});
