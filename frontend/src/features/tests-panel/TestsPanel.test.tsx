import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createApiClient, type Schemas } from '../api';
import { server } from '../../mocks/server';
import { fixtures } from '../../mocks/fixtures';
import { scenarios } from '../../mocks/handlers';
import { resetAppState, useAppStore } from '../../app/store';
import type { JUnitSourceEditorProps } from './JUnitSourceEditor';
import { resetTestsState, useTestsStore } from './testsStore';
import { TestsPanel } from './TestsPanel';
import { OutputDiff } from './ResultView';

// Monaco в jsdom не работает — подменяем редактор JUnit textarea с тем же интерфейсом.
vi.mock('./JUnitSourceEditor', () => ({
  default: ({ value, onChange }: JUnitSourceEditorProps) => (
    <textarea aria-label="JUnit-код" defaultValue={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const API = '*/api';
const client = createApiClient('http://localhost/api');

function renderPanel() {
  return render(<TestsPanel client={client} />);
}

async function openItem(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
}

describe('панель тестов', () => {
  beforeEach(() => {
    resetAppState();
    resetTestsState();
    useAppStore.getState().openProject('p-1', 5);
  });

  it('список IO- и JUnit-тестов на фикстурах', async () => {
    renderPanel();
    const list = await screen.findByRole('navigation', { name: 'Тесты проекта' });
    await within(list).findByText('merge');
    expect(within(list).getByText('IO-тесты · 1')).toBeInTheDocument();
    expect(within(list).getByText('JUnit · 1')).toBeInTheDocument();
    expect(within(list).getByText('OrderServiceTest')).toBeInTheDocument();
    expect(within(list).getByText('оригинал')).toBeInTheDocument();

    await openItem('OrderServiceTest');
    expect(await screen.findByLabelText('JUnit-код')).toHaveValue(fixtures.testJunit.source);
  });

  it('создание IO-теста уходит PUT с version, новая версия — в store', async () => {
    let body: unknown = null;
    server.use(
      http.put(`${API}/projects/:projectId/tests/:name`, async ({ request, params }) => {
        body = await request.json();
        const { version, ...test } = body as Schemas['TestCase'] & { version: number };
        expect(params.name).toBe('empty');
        return HttpResponse.json<Schemas['TestMutationResult']>({ version: version + 1, test });
      }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: '+ IO-тест' }));
    const form = await screen.findByRole('form', { name: /IO-тест/ });
    fireEvent.change(within(form).getByLabelText('Имя'), { target: { value: 'empty' } });
    fireEvent.change(within(form).getByLabelText('stdin'), { target: { value: '0\n' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Задать вручную' }));
    fireEvent.change(within(form).getByLabelText('Ожидаемый stdout'), { target: { value: 'нет заказов\n' } });
    fireEvent.change(within(form).getByLabelText('Игнорируемые строки вывода'), { target: { value: '3, 1' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(useAppStore.getState().version).toBe(6));
    expect(body).toEqual({
      name: 'empty',
      type: 'io',
      stdin: '0\n',
      mode: 'manual',
      expected: 'нет заказов\n',
      ignoreLines: [1, 3],
      version: 5,
    });
    const list = screen.getByRole('navigation', { name: 'Тесты проекта' });
    expect(within(list).getByRole('button', { name: /empty/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('409 на PUT → тост и перезагрузка версии и списка, черновик отброшен', async () => {
    server.use(scenarios.conflictOnTest);
    let listCalls = 0;
    server.use(
      http.get(`${API}/projects/:projectId/tests`, () => {
        listCalls++;
        return HttpResponse.json<Schemas['TestCase'][]>([...fixtures.project.tests, fixtures.testJunit]);
      }),
    );
    renderPanel();
    await openItem('merge');
    const form = await screen.findByRole('form', { name: /IO-тест merge/ });
    fireEvent.change(within(form).getByLabelText('stdin'), { target: { value: 'черновик' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));

    const toast = await screen.findByText('Проект изменён');
    expect(toast.parentElement).toHaveTextContent('Ваша правка относилась к версии 2, сейчас 3. Состояние перезагружено.');
    // GET /projects/{id} (фикстура project.json, version 1) — версия взята с сервера.
    await waitFor(() => expect(useAppStore.getState().version).toBe(1));
    await waitFor(() => expect(listCalls).toBe(2));
    const reloaded = await screen.findByRole('form', { name: /IO-тест merge/ });
    expect(within(reloaded).getByLabelText('stdin')).toHaveValue(fixtures.project.tests[0]?.stdin);

    // Правка не пропала: тост сообщает об этом, текст можно скопировать и вернуть в форму.
    expect(toast.parentElement).toHaveTextContent('Ваша правка не сохранена.');
    expect((screen.getByLabelText('Текст несохранённой правки') as HTMLTextAreaElement).value).toContain('черновик');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить с моей правкой' }));
    expect(screen.queryByText('Проект изменён')).not.toBeInTheDocument();
    const restored = await screen.findByRole('form', { name: /IO-тест merge/ });
    expect(within(restored).getByLabelText('stdin')).toHaveValue('черновик');

    // Повтор уходит с новой версией.
    server.resetHandlers();
    fireEvent.click(within(restored).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(useAppStore.getState().version).toBe(2));
  });

  it('409 при создании JUnit-класса: новый тест возвращается в форму с именем и текстом', async () => {
    server.use(scenarios.conflictOnTest);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: '+ JUnit-класс' }));
    const form = await screen.findByRole('form', { name: /JUnit-тест/ });
    fireEvent.change(within(form).getByLabelText('Имя'), { target: { value: 'ReportTest' } });
    fireEvent.change(within(form).getByLabelText('JUnit-код'), { target: { value: 'class ReportTest {}' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Создать' }));

    expect(await screen.findByText('Проект изменён')).toBeInTheDocument();
    // Тост с правкой не исчезает по таймеру — только по кнопке.
    expect(screen.getByLabelText('Текст несохранённой правки')).toHaveValue('class ReportTest {}');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить с моей правкой' }));
    const restored = await screen.findByRole('form', { name: /JUnit-тест/ });
    expect(within(restored).getByLabelText('Имя')).toHaveValue('ReportTest');
    expect(within(restored).getByLabelText('JUnit-код')).toHaveValue('class ReportTest {}');
    expect(within(restored).getByRole('button', { name: 'Создать' })).toBeInTheDocument();
  });

  it('запуск при несохранённой правке не закрывает форму: пункт «Последний запуск» с бейджем', async () => {
    renderPanel();
    await openItem('merge');
    const form = await screen.findByRole('form', { name: /IO-тест merge/ });
    fireEvent.change(within(form).getByLabelText('stdin'), { target: { value: 'правка' } });
    await waitFor(() => expect(useTestsStore.getState().dirty).toBe(true));

    act(() => useTestsStore.getState().showRunResult(fixtures.runOk));
    expect(within(screen.getByRole('form', { name: /IO-тест merge/ })).getByLabelText('stdin')).toHaveValue('правка');
    expect(screen.queryByLabelText('Результат запуска')).not.toBeInTheDocument();
    const runItem = screen.getByRole('button', { name: /Последний запуск/ });
    expect(runItem).toHaveTextContent('новый');

    fireEvent.click(runItem);
    expect(screen.getByLabelText('Результат запуска')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Последний запуск/ })).not.toHaveTextContent('новый');
  });

  it('форма с правкой размонтирована без select (вкладка закрыта) → запуск снова открывает результат', async () => {
    const view = renderPanel();
    await openItem('merge');
    const form = await screen.findByRole('form', { name: /IO-тест merge/ });
    fireEvent.change(within(form).getByLabelText('stdin'), { target: { value: 'правка' } });
    await waitFor(() => expect(useTestsStore.getState().dirty).toBe(true));

    view.unmount();
    expect(useTestsStore.getState().dirty).toBe(false);

    renderPanel();
    await screen.findByRole('button', { name: /merge/ });
    act(() => useTestsStore.getState().showRunResult(fixtures.runOk));
    expect(screen.getByLabelText('Результат запуска')).toHaveTextContent('merged=2');
  });

  it('результат, показанный до монтирования панели, сохраняется', async () => {
    useTestsStore.getState().showVerifyResult(fixtures.verifyRed);
    useTestsStore.getState().showRunResult(fixtures.runOk);
    renderPanel();
    await screen.findByRole('button', { name: /merge/ });
    expect(useTestsStore.getState().verify).toEqual(fixtures.verifyRed);
    expect(screen.getByLabelText('Результат запуска')).toHaveTextContent('merged=2');
  });

  it('смена проекта в useAppStore сбрасывает результаты и привязывает стор к новому проекту', () => {
    act(() => useTestsStore.getState().showRunResult(fixtures.runOk));
    act(() => useAppStore.getState().openProject('p-2'));
    expect(useTestsStore.getState().projectId).toBe('p-2');
    expect(useTestsStore.getState().run).toBeNull();
  });

  it('смена проекта сбрасывает dirty и возвращённый черновик', async () => {
    useTestsStore.setState({
      projectId: 'p-1',
      dirty: true,
      restored: { test: fixtures.testJunit, isNew: false },
    });
    await useTestsStore.getState().load(client, 'p-2');
    expect(useTestsStore.getState().dirty).toBe(false);
    expect(useTestsStore.getState().restored).toBeNull();
  });

  it('неизвестный статус проверки и теста — нейтрально', async () => {
    renderPanel();
    await screen.findByRole('button', { name: /merge/ });
    act(() =>
      useTestsStore.getState().showVerifyResult({
        status: 'weird',
        results: [{ name: 'merge', type: 'io', status: 'skipped', durationMs: 1 }],
      } as unknown as Schemas['VerifyResult']),
    );
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Статус проверки неизвестен');
    expect(banner).toHaveAttribute('data-status', 'unknown');
    await openItem('merge');
    expect(screen.getAllByTitle('неизвестно').length).toBeGreaterThan(0);
  });

  it('409 на DELETE → тост и перезагрузка', async () => {
    server.use(scenarios.conflictOnTestDelete);
    renderPanel();
    await openItem('OrderServiceTest');
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Проект изменён')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /OrderServiceTest/ })).toBeInTheDocument();
  });

  it('удаление уходит DELETE с version в query', async () => {
    let query: string | null = null;
    server.use(
      http.delete(`${API}/projects/:projectId/tests/:name`, ({ request }) => {
        query = new URL(request.url).searchParams.get('version');
        return HttpResponse.json({ version: 6 });
      }),
    );
    renderPanel();
    await openItem('OrderServiceTest');
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /OrderServiceTest/ })).not.toBeInTheDocument());
    expect(query).toBe('5');
    expect(useAppStore.getState().version).toBe(6);
  });

  it('422 → ошибка в форме, черновик остаётся, версия прежняя', async () => {
    server.use(scenarios.invalidTest);
    renderPanel();
    await openItem('OrderServiceTest');
    const editor = await screen.findByLabelText('JUnit-код');
    fireEvent.change(editor, { target: { value: 'class Broken {' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('JUnit-текст не разбирается: строка 3');
    expect(screen.getByLabelText('JUnit-код')).toHaveValue('class Broken {');
    expect(useAppStore.getState().version).toBe(5);
  });

  it('verify.red.json: плашка, статусы в списке, diff вывода и ошибка компиляции', async () => {
    renderPanel();
    await screen.findByRole('button', { name: /merge/ });
    act(() => useTestsStore.getState().showVerifyResult(fixtures.verifyRed));

    expect(screen.getByRole('status')).toHaveTextContent('Поведение отличается — 2 из 3 тестов');
    const list = screen.getByRole('navigation', { name: 'Тесты проекта' });
    expect(within(list).getByText('не компилируется')).toBeInTheDocument();
    // basic — результат без теста в списке.
    expect(within(list).getByText('Только результаты · 1')).toBeInTheDocument();

    await openItem('merge');
    const diff = screen.getByLabelText('Сравнение вывода');
    expect(diff).toHaveTextContent('отличается со строки 1');
    const bad = diff.querySelectorAll('[data-kind="diff"]');
    expect(bad).toHaveLength(2);
    expect(bad[0]).toHaveTextContent('merged=2');
    expect(bad[1]).toHaveTextContent('merged=1');

    await openItem('OrderServiceTest');
    expect(screen.getByTestId('result-error')).toHaveTextContent('OrderServiceTest.java:12: cannot find symbol');
  });

  it('noisyLines — серым и не считаются отличием', () => {
    render(<OutputDiff expected={'a\nt=1\nb\n'} actual={'a\nt=2\nb\n'} noisyLines={[2]} />);
    const diff = screen.getByLabelText('Сравнение вывода');
    expect(diff).toHaveTextContent('совпадает');
    const noisy = diff.querySelectorAll('[data-kind="noisy"]');
    expect(noisy).toHaveLength(2);
    expect(noisy[0]?.className).toMatch(/lineNoise/);
    expect(diff).toHaveTextContent('шумные строки');
  });

  it('error у пройденного теста — нейтральное пояснение', async () => {
    renderPanel();
    await screen.findByRole('button', { name: /merge/ });
    act(() =>
      useTestsStore.getState().showVerifyResult({
        status: 'green',
        results: [
          { name: 'merge', type: 'io', status: 'passed', durationMs: 10, error: 'оригинал не проходит этот тест — правка его исправила' },
        ],
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Поведение совпадает');
    await openItem('merge');
    const note = screen.getByTestId('result-error');
    expect(note.className).toMatch(/note/);
    expect(note.className).not.toMatch(/errorText/);
  });

  it('run.ok.json: последний запуск', async () => {
    renderPanel();
    await screen.findByRole('button', { name: /merge/ });
    act(() => useTestsStore.getState().showRunResult(fixtures.runOk));
    const run = screen.getByLabelText('Результат запуска');
    expect(run).toHaveTextContent('exit code 0');
    expect(run).toHaveTextContent('merged=2');
  });
});
