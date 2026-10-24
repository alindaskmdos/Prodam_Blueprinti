import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createApiClient, type Schemas } from '../../api';
import { server } from '../../../mocks/server';
import { fixtures } from '../../../mocks/fixtures';
import { resetAppState, useAppStore } from '../../../app/store';
import { findCommand } from '../../../app/commands';
import { ProjectTree } from '../ProjectTree';
import { resetTreeState } from '../treeStore';
import { StructurePanel } from './StructurePanel';
import { openStructureDialog, resetStructureState, selectClass, STRUCTURE_PANEL_ID, useStructureStore } from './structureStore';

const client = createApiClient('http://localhost/api');
const file = fixtures.fileOrderService;
const mergeId = 'com.demo.service.OrderService.merge~0';
const ref = { path: file.path, name: 'OrderService' };

/** Перехват PUT files: присланные тела; ответ — как мок по умолчанию или `reply`. */
function capturePut(reply?: () => Response) {
  const bodies: { version: number; text: string }[] = [];
  server.use(
    http.put('*/api/projects/:projectId/files', async ({ request }) => {
      const body = (await request.json()) as { version: number; text: string };
      bodies.push(body);
      if (reply) return reply();
      return HttpResponse.json<Schemas['MutationResult']>({
        version: body.version + 1,
        fileText: body.text,
        tree: fixtures.tree,
        analysis: fixtures.analysisMerge,
      });
    }),
  );
  return bodies;
}

/** Строка `line` (с 1) текста. */
const lineAt = (text: string, line: number) => text.split('\n')[line - 1];

async function setup() {
  render(
    <>
      <ProjectTree client={client} projectId="p-1" />
      <StructurePanel />
    </>,
  );
  await screen.findByTestId('project-tree');
}

describe('формы структуры (FE-10)', () => {
  beforeEach(() => {
    resetAppState();
    resetTreeState();
    resetStructureState();
    useAppStore.getState().openProject('p-1');
  });

  it('клик по классу открывает форму во вкладке «Свойства»; переименование правит только строку заголовка', async () => {
    const puts = capturePut();
    await setup();
    expect(screen.getByText(/Выберите класс, поле или метод/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^OrderService/ }));
    expect(useAppStore.getState().activePanels.right).toBe(STRUCTURE_PANEL_ID);
    const form = await screen.findByRole('form', { name: 'Свойства класса OrderService' });
    fireEvent.change(within(form).getByLabelText('Имя'), { target: { value: 'Orders' } });
    fireEvent.click(within(form).getByLabelText('final'));
    fireEvent.change(within(form).getByLabelText('implements'), { target: { value: 'Runnable, Comparable<Orders>' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    const sent = puts[0];
    expect(sent?.version).toBe(file.version);
    const before = file.text.split('\n');
    const after = sent?.text.split('\n') ?? [];
    expect(after[10]).toBe('public final class Orders implements Runnable, Comparable<Orders> {');
    expect(after.filter((_, i) => i !== 10)).toEqual(before.filter((_, i) => i !== 10));
    await waitFor(() => expect(useAppStore.getState().version).toBe(file.version + 1));
  });

  it('форма метода: новый параметр и throws → заголовок merge, тело не трогается', async () => {
    const puts = capturePut();
    await setup();
    fireEvent.click(screen.getByRole('button', { name: /merge/ }));
    const form = await screen.findByRole('form', { name: 'Свойства метода merge' });
    fireEvent.click(within(form).getByRole('button', { name: '+ параметр' }));
    fireEvent.change(within(form).getByLabelText('Тип параметра 1'), { target: { value: 'int' } });
    fireEvent.change(within(form).getByLabelText('Имя параметра 1'), { target: { value: 'limit' } });
    fireEvent.change(within(form).getByLabelText('throws'), { target: { value: 'IllegalStateException' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    const text = puts[0]?.text ?? '';
    expect(lineAt(text, 37)).toBe('    public int merge(int limit) throws IllegalStateException {');
    expect(text.replace('merge(int limit) throws IllegalStateException', 'merge()')).toBe(file.text);
  });

  it('тип результата и параметра — datalist: void только у «Возвращает», классы проекта в подсказках', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: /merge/ }));
    const form = await screen.findByRole('form', { name: 'Свойства метода merge' });
    const options = (label: string) =>
      Array.from((within(form).getByLabelText(label) as HTMLInputElement).list?.options ?? []).map((o) => o.value);
    expect(options('Возвращает')).toEqual(expect.arrayContaining(['void', 'int', 'String', 'OrderService']));
    fireEvent.click(within(form).getByRole('button', { name: '+ параметр' }));
    expect(options('Тип параметра 1')).toContain('OrderService');
    expect(options('Тип параметра 1')).not.toContain('void');
  });

  it('422 PARSE_ERROR — ошибка со строкой в форме, версия не меняется', async () => {
    capturePut(() =>
      HttpResponse.json<Schemas['Error']>({ code: 'PARSE_ERROR', message: 'ожидался идентификатор', line: 37 }, { status: 422 }),
    );
    await setup();
    act(() => useAppStore.getState().selectMethod(mergeId));
    const form = await screen.findByRole('form', { name: 'Свойства метода merge' });
    fireEvent.change(within(form).getByLabelText('Возвращает'), { target: { value: 'long' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Строка 37: ожидался идентификатор');
    expect(useAppStore.getState().version).toBe(file.version);
  });

  it('409 — дерево перезагружается, ошибка «повторите»', async () => {
    capturePut(() => HttpResponse.json(fixtures.errorConflict, { status: 409 }));
    await setup();
    act(() => useAppStore.getState().selectMethod(mergeId));
    const form = await screen.findByRole('form', { name: 'Свойства метода merge' });
    fireEvent.click(within(form).getByLabelText('static'));
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/Проект изменён/);
  });

  it('поле: тип и модификаторы, инициализатор сохраняется', async () => {
    const puts = capturePut();
    await setup();
    fireEvent.click(screen.getByRole('button', { name: /orders/ }));
    const form = await screen.findByRole('form', { name: 'Свойства поля orders' });
    fireEvent.change(within(form).getByLabelText('Тип'), { target: { value: 'ArrayList<Order>' } });
    fireEvent.click(within(form).getByLabelText('protected'));
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(lineAt(puts[0]?.text ?? '', 14)).toBe('    protected final ArrayList<Order> orders = new ArrayList<>();');
  });

  it('старый бэк без headerStart/headerEnd — форма только для чтения', async () => {
    const old = structuredClone(fixtures.tree);
    const cls = old.packages[0]?.files[0]?.classes[0];
    if (cls) {
      delete cls.headerStart;
      delete cls.headerEnd;
    }
    server.use(http.get('*/api/projects/:projectId/tree', () => HttpResponse.json(old)));
    await setup();
    fireEvent.click(screen.getByRole('button', { name: /^OrderService/ }));
    const form = await screen.findByRole('form', { name: 'Свойства класса OrderService' });
    expect(within(form).getByText(/форма только для чтения/)).toBeInTheDocument();
    expect(within(form).queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument();
    expect(within(form).getByLabelText('Имя')).toBeDisabled();
  });

  it('команда «Новый метод» → диалог → метод с return перед закрывающей «}» класса, он выбирается', async () => {
    const puts = capturePut();
    await setup();
    act(() => useAppStore.getState().selectMethod(mergeId));
    const command = findCommand('structure.newMethod');
    expect(command?.isEnabled?.()).toBe(true);
    act(() => void command?.run());
    const dialog = await screen.findByRole('dialog', { name: 'Новый метод в OrderService' });
    fireEvent.change(within(dialog).getByLabelText('Возвращает'), { target: { value: 'boolean' } });
    fireEvent.change(within(dialog).getByLabelText('Имя'), { target: { value: 'isEmpty' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    const text = puts[0]?.text ?? '';
    expect(text.endsWith('    }\n\n    public boolean isEmpty() {\n        return false;\n    }\n}\n')).toBe(true);
    expect(text.startsWith(file.text.slice(0, file.text.lastIndexOf('}')))).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('удаление метода с подтверждением: строки метода вырезаны, выбор снят', async () => {
    const puts = capturePut();
    await setup();
    act(() => useAppStore.getState().selectMethod(mergeId));
    const form = await screen.findByRole('form', { name: 'Свойства метода merge' });
    fireEvent.click(within(form).getByRole('button', { name: 'Удалить метод' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить метод?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    const text = puts[0]?.text ?? '';
    expect(text).not.toContain('public int merge()');
    expect(text).not.toContain('DEFECT NestedLoopSameCollection'); // javadoc над методом тоже
    expect(text).toContain('    private void absorb(Order target, Order source) {');
    await waitFor(() => expect(useAppStore.getState().selectedMethodId).toBeNull());
  });

  it('новый класс: диалог из «+» в шапке дерева, класс дописывается в файл пакета', async () => {
    const puts = capturePut();
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Новый класс' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новый класс' });
    fireEvent.change(within(dialog).getByLabelText('Имя'), { target: { value: 'OrderService' } });
    expect(within(dialog).getByRole('button', { name: 'Создать' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Имя'), { target: { value: 'Report' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.text).toBe(`${file.text}\nclass Report {\n}\n`);
  });

  it('selectClass(fqn) — общий API выбора класса; выбор метода снимает выбор класса', async () => {
    await setup();
    let ok = false;
    act(() => {
      ok = selectClass('com.demo.service.OrderService');
    });
    expect(ok).toBe(true);
    expect(useStructureStore.getState().selection).toEqual({ kind: 'class', ref });
    expect(selectClass('no.Such')).toBe(false);
    act(() => useAppStore.getState().selectMethod(mergeId));
    expect(useStructureStore.getState().selection).toBeNull();
    act(() => openStructureDialog({ kind: 'delete', target: { kind: 'field', ref, field: 'orders' } }));
    expect(await screen.findByRole('dialog', { name: 'Удалить поле?' })).toBeInTheDocument();
  });

  it('проблема с methodId, выбранная после класса, и клик по ноде холста снимают выбор класса (приоритет — последнее действие)', async () => {
    await setup();
    // Метод уже выбран: selectedMethodId при выборе его проблемы не меняется, выбор класса всё равно уступает.
    act(() => useAppStore.getState().selectMethod(mergeId));
    act(() => void selectClass('com.demo.service.OrderService'));
    expect(useStructureStore.getState().selection).not.toBeNull();
    act(() => useAppStore.getState().selectIssue({ issueId: 'i-1', methodId: mergeId, blockId: 'b-1' }));
    expect(useStructureStore.getState().selection).toBeNull();
    // Клик по ноде холста.
    act(() => void selectClass('com.demo.service.OrderService'));
    expect(useAppStore.getState().selectedIssueId).toBeNull();
    act(() => useAppStore.getState().setHighlight({ source: 'canvas', blockId: 'b-2' }));
    expect(useStructureStore.getState().selection).toBeNull();
    // Курсор в Monaco выбор класса не снимает.
    act(() => void selectClass('com.demo.service.OrderService'));
    act(() => useAppStore.getState().setHighlight({ source: 'code', span: { file: file.path, startLine: 1, endLine: 1 } }));
    expect(useStructureStore.getState().selection).not.toBeNull();
  });
});
