import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createApiClient, type Schemas } from '../../api';
import { server } from '../../../mocks/server';
import { fixtures } from '../../../mocks/fixtures';
import { resetAppState, useAppStore } from '../../../app/store';
import { ProjectTree } from '../ProjectTree';
import { resetTreeState } from '../treeStore';
import { StructurePanel } from './StructurePanel';
import { resetStructureState } from './structureStore';

const client = createApiClient('http://localhost/api');

// Тестовые данные: record в отдельном файле. Компоненты бэк отдаёт полями без span (TreeBuilder).
const PATH = 'src/p/Point.java';
const TEXT = 'package p;\n\npublic record Point(int x, @Ann List<String> tags, String... rest) implements Shape {\n}\n';
const HEADER_LINE = 3;

function treeWithRecord(): Schemas['ProjectTree'] {
  const tree = structuredClone(fixtures.tree);
  const base = structuredClone(tree.packages[0]?.files[0]?.classes[0] as Schemas['ClassNode']);
  const column = (TEXT.split('\n')[HEADER_LINE - 1] ?? '').indexOf('{') + 1;
  const comp = (type: string, name: string): Schemas['ClassNode']['fields'][number] => ({
    name,
    type,
    modifiers: ['private', 'final'],
  });
  const point: Schemas['ClassNode'] = {
    ...base,
    name: 'Point',
    kind: 'record',
    fqn: 'p.Point',
    modifiers: ['public'],
    implements: ['Shape'],
    fields: [comp('int', 'x'), comp('List<String>', 'tags'), comp('String[]', 'rest')],
    constructors: [],
    methods: [],
    headerStart: { line: HEADER_LINE, column: 1 },
    headerEnd: { line: HEADER_LINE, column },
  };
  tree.packages.push({ name: 'p', files: [{ path: PATH, classes: [point] }] });
  return tree;
}

/** GET tree/files под record и перехват PUT files. */
function mockBackend() {
  const bodies: { version: number; text: string }[] = [];
  const tree = treeWithRecord();
  server.use(
    http.get('*/api/projects/:projectId/tree', () => HttpResponse.json(tree)),
    http.get('*/api/projects/:projectId/files', ({ request }) => {
      const path = new URL(request.url).searchParams.get('path');
      if (path === PATH) return HttpResponse.json({ ...fixtures.fileOrderService, path: PATH, text: TEXT });
      return HttpResponse.json(fixtures.fileOrderService);
    }),
    http.put('*/api/projects/:projectId/files', async ({ request }) => {
      const body = (await request.json()) as { version: number; text: string };
      bodies.push(body);
      return HttpResponse.json<Schemas['MutationResult']>({
        version: body.version + 1,
        fileText: body.text,
        tree,
        analysis: fixtures.analysisMerge,
      });
    }),
  );
  return bodies;
}

async function openRecord(field: string) {
  render(
    <>
      <ProjectTree client={client} projectId="p-1" />
      <StructurePanel />
    </>,
  );
  await screen.findByTestId('project-tree');
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^f${field}$`) }));
  return screen.findByRole('form', { name: 'Свойства класса Point' });
}

const HEADER = (components: string) => TEXT.replace('(int x, @Ann List<String> tags, String... rest)', `(${components})`);

describe('record: компоненты в форме класса (FE-44)', () => {
  beforeEach(() => {
    resetAppState();
    resetTreeState();
    resetStructureState();
    useAppStore.getState().openProject('p-1');
  });

  it('клик по компоненту открывает форму класса с подсвеченной строкой, а не read-only поле', async () => {
    mockBackend();
    const form = await openRecord('tags');
    expect(within(form).queryByText(/Бэк не прислал span поля/)).not.toBeInTheDocument();
    expect(within(form).getByLabelText('Тип компонента 1')).toHaveValue('int');
    // Аннотация и varargs остаются в тексте типа — не теряются при правке.
    expect(within(form).getByLabelText('Тип компонента 2')).toHaveValue('@Ann List<String>');
    expect(within(form).getByLabelText('Тип компонента 3')).toHaveValue('String...');
    const row = within(form).getByLabelText('Имя компонента 2').parentElement;
    expect(row).toHaveAttribute('data-highlight');
    expect(within(form).getByLabelText('Имя компонента 1').parentElement).not.toHaveAttribute('data-highlight');
  });

  it('правка типа компонента меняет только текст в скобках, остальные компоненты байт в байт', async () => {
    const puts = mockBackend();
    const form = await openRecord('x');
    fireEvent.change(within(form).getByLabelText('Тип компонента 1'), { target: { value: 'long' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.text).toBe(HEADER('long x, @Ann List<String> tags, String... rest'));
  });

  it('добавление, удаление и перестановка компонентов', async () => {
    const puts = mockBackend();
    const form = await openRecord('x');
    fireEvent.click(within(form).getByRole('button', { name: '+ компонент' }));
    fireEvent.change(within(form).getByLabelText('Тип компонента 4'), { target: { value: 'double' } });
    fireEvent.change(within(form).getByLabelText('Имя компонента 4'), { target: { value: 'z' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Удалить компонент 1' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Компонент 2 выше' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.text).toBe(HEADER('String... rest, @Ann List<String> tags, double z'));
  });

  it('повторяющееся имя компонента блокирует сохранение', async () => {
    mockBackend();
    const form = await openRecord('x');
    fireEvent.change(within(form).getByLabelText('Имя компонента 1'), { target: { value: 'tags' } });
    expect(within(form).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(within(form).getByText(/«tags» повторяется/)).toBeInTheDocument();
  });

  it('datalist типа содержит примитивы, JDK и классы проекта; void — только у «Возвращает»', async () => {
    mockBackend();
    const form = await openRecord('x');
    const options = (input: HTMLElement) =>
      Array.from((input as HTMLInputElement).list?.options ?? []).map((o) => o.value);
    const component = options(within(form).getByLabelText('Тип компонента 1'));
    expect(component).toEqual(expect.arrayContaining(['int', 'String', 'List<>', 'Map<,>', 'Optional<>', 'OrderService', 'Point']));
    expect(component).not.toContain('void');

    // implements — список: подсказка подставляется после последней запятой.
    const impl = within(form).getByLabelText('implements');
    fireEvent.change(impl, { target: { value: 'Shape, ' } });
    expect(options(impl)).toContain('Shape, OrderService');
  });
});
