import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import analysisJson from '@contract/fixtures/analysis.merge.json';
import treeJson from '@contract/fixtures/tree.json';
import type { MonacoViewProps } from '../features/editor-code/MonacoView';
import { resetAiState, resetCapabilitiesState, useCapabilitiesStore } from '../features/ai';
import { createApiClient, resetMethodBlocks } from '../features/api';
import { resetAnalysisState } from '../features/analysis-panel';
import { resetFixState } from '../features/fix';
import { resetStructureState, resetTreeState } from '../features/project-tree';
import { resetSandboxState, useSandboxStore } from '../features/sandbox';
import { resetTestsState } from '../features/tests-panel';
import { fixtures } from '../mocks/fixtures';
import { scenarios } from '../mocks/handlers';
import { server } from '../mocks/server';
import { App } from './App';
import { resetAppState, useAppStore } from './store';

// Monaco в jsdom не работает — подменяем textarea.
vi.mock('../features/editor-code/MonacoView', () => ({
  default: ({ text }: MonacoViewProps) => <textarea aria-label="код" readOnly value={text} />,
}));

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
const merge = treeJson.packages[0]?.files[0]?.classes[0]?.methods[0];
if (!merge) throw new Error('в tree.json нет метода');
const issue = analysisJson.issues.find((i) => i.fixes.length > 0);
if (!issue) throw new Error('analysis.merge.json: нужна проблема с фиксом');

/** Запросы мутаций: метод, путь с query и тело. */
function track() {
  const calls: { method: string; url: URL; body: Record<string, unknown> | null }[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'GET') return;
    const url = new URL(request.url);
    void request
      .clone()
      .json()
      .catch(() => null)
      .then((body: Record<string, unknown> | null) => calls.push({ method: request.method, url, body }));
  });
  return calls;
}

/** App с открытой схемой метода merge; ждёт загрузки /capabilities и песочницы (клиент для команд). */
async function openMergeMethod() {
  render(<App client={client} projectId="p-1" />);
  await waitFor(() => expect(useCapabilitiesStore.getState().caps).not.toBeNull());
  await waitFor(() => expect(useSandboxStore.getState().client).not.toBeNull());
  await waitFor(() => expect(useAppStore.getState().version).toBe(treeJson.version));
  act(() => useAppStore.getState().selectMethod(merge?.id ?? null));
  await screen.findByTestId('node-method', {}, { timeout: 10_000 });
}

/** Нода var «Order a = orders.get(i)». */
function varNode(): HTMLElement {
  const node = screen.getAllByTestId('node-var').find((n) => n.textContent?.includes('a = orders.get(i)'));
  if (!node) throw new Error('нет ноды var a');
  return node;
}

beforeEach(() => {
  resetAppState();
  resetTreeState();
  resetStructureState();
  resetAnalysisState();
  resetTestsState();
  resetSandboxState();
  resetFixState();
  resetAiState();
  resetCapabilitiesState();
  resetMethodBlocks();
});
afterEach(() => {
  server.events.removeAllListeners();
});

describe('FE-24: кнопки ИИ по /capabilities', () => {
  it('llm=false → кнопок ИИ нет (не disabled, а отсутствуют)', async () => {
    server.use(scenarios.aiOff);
    render(<App client={client} projectId="p-1" />);
    await waitFor(() => expect(useSandboxStore.getState().client).not.toBeNull());
    act(() => useAppStore.getState().selectMethod(merge?.id ?? null));
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    await screen.findAllByTestId('issue');
    await waitFor(() => expect(useCapabilitiesStore.getState().caps).toEqual(fixtures.capabilitiesOff));

    expect(screen.queryByRole('button', { name: /Объясни метод/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Изменить текстом/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Предложить фикс \(ИИ\)/ })).not.toBeInTheDocument();
  }, 20_000);

  it('функции нет в features → нет только её кнопки', async () => {
    server.use(http.get('*/api/capabilities', () => HttpResponse.json({ ...fixtures.capabilitiesOn, features: ['explain'] })));
    await openMergeMethod();
    await screen.findAllByTestId('issue');

    expect(screen.getByRole('button', { name: 'Объясни метод' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Изменить текстом/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Предложить фикс \(ИИ\)/ })).not.toBeInTheDocument();
  }, 20_000);

  it('explain: версия в запросе, текст объяснения в диалоге', async () => {
    const calls = track();
    await openMergeMethod();

    fireEvent.click(screen.getByRole('button', { name: 'Объясни метод' }));

    const text = await screen.findByTestId('ai-explanation');
    // Markdown рендерится ленивым чанком — ждём его.
    await waitFor(() => expect(text).toHaveTextContent('Для каждого заказа ищет в списке'));
    expect(text.querySelector('strong')).toHaveTextContent('Что делает.');
    expect(text).not.toHaveTextContent('**');
    const explain = calls.find((c) => c.url.pathname.endsWith('/explain'));
    expect(explain?.body).toEqual({ version: useAppStore.getState().version });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByTestId('ai-dialog')).not.toBeInTheDocument();
  }, 20_000);

  it('FE-49: ответ explain — markdown: заголовок, список, код, таблица, ссылка; сырой HTML не исполняется', async () => {
    const md = [
      '# Слияние заказов',
      '',
      'Метод **сливает** заказы.',
      '',
      '## Шаги',
      '',
      '- обходит `orders`',
      '- ищет пару',
      '',
      '```java',
      'for (Order a : orders) { merge(a); }',
      '```',
      '',
      '| n | операций |',
      '|---|---|',
      '| 10 | 100 |',
      '',
      '> цитата',
      '',
      '[док](https://example.com/doc)',
      '',
      '<img src="x" onerror="alert(1)"><script>alert(2)</script>',
    ].join('\n');
    server.use(
      http.post('*/api/projects/:projectId/methods/:methodId/explain', () =>
        HttpResponse.json({ version: treeJson.version, text: md }),
      ),
    );
    await openMergeMethod();

    fireEvent.click(screen.getByRole('button', { name: 'Объясни метод' }));

    const box = await screen.findByTestId('ai-explanation');
    const h1 = await within(box).findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Слияние заказов');
    expect(within(box).getByRole('heading', { level: 2 })).toHaveTextContent('Шаги');
    expect(box).not.toHaveTextContent('#');
    const items = within(box).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(box.querySelector('ul code')).toHaveTextContent('orders');
    expect(box.querySelector('pre code')).toHaveTextContent('for (Order a : orders) { merge(a); }');
    expect(box).not.toHaveTextContent('```');
    expect(within(box).getByRole('table')).toBeInTheDocument();
    expect(box.querySelector('blockquote')).toHaveTextContent('цитата');
    const link = within(box).getByRole('link', { name: 'док' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(box.querySelector('img, script')).toBeNull();
  }, 20_000);

  it('429 RATE_LIMITED → показано message сервера', async () => {
    server.use(...scenarios.aiRateLimited);
    await openMergeMethod();

    fireEvent.click(screen.getByRole('button', { name: 'Объясни метод' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(fixtures.errorRateLimited.message);
  }, 20_000);

  it('503 LLM_UNAVAILABLE → показано message', async () => {
    server.use(scenarios.llmUnavailable);
    await openMergeMethod();

    fireEvent.click(screen.getByRole('button', { name: 'Объясни метод' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ИИ недоступен: провайдер не ответил');
  }, 20_000);

  it('ai-edit: дифф без PUT до «Применить», затем PUT files с text и version из ответа', async () => {
    const proposal = { ...fixtures.aiEditMerge, version: 41 };
    server.use(http.post('*/api/projects/:projectId/methods/:methodId/ai-edit', () => HttpResponse.json(proposal)));
    const calls = track();
    await openMergeMethod();

    fireEvent.click(within(varNode()).getByRole('button', { name: /Изменить текстом \(ИИ\)/ }));
    const dialog = screen.getByTestId('ai-dialog');
    fireEvent.change(within(dialog).getByLabelText('Что изменить'), { target: { value: 'добавь проверку на null' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Предложить правку' }));

    const diff = await within(dialog).findByTestId('ai-diff');
    expect(diff.querySelectorAll('[data-kind="add"]').length).toBeGreaterThan(0);
    expect(diff).toHaveTextContent('if (orders == null)');
    const edit = calls.find((c) => c.url.pathname.endsWith('/ai-edit'));
    expect(edit?.body).toEqual({
      version: useAppStore.getState().version,
      blockId: expect.any(String) as string,
      instruction: 'добавь проверку на null',
    });
    // Сразу ничего не применено.
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));

    await waitFor(() => expect(screen.queryByTestId('ai-dialog')).not.toBeInTheDocument());
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.url.pathname).toMatch(/\/files$/);
    expect(puts[0]?.url.searchParams.get('path')).toBe(proposal.path);
    expect(puts[0]?.body).toEqual({ version: 41, text: proposal.text });
    expect(useAppStore.getState().version).toBe(42);
  }, 20_000);

  it('ai-edit: «Отмена» ничего не меняет', async () => {
    const calls = track();
    await openMergeMethod();
    const versionBefore = useAppStore.getState().version;

    fireEvent.click(within(varNode()).getByRole('button', { name: /Изменить текстом \(ИИ\)/ }));
    const dialog = screen.getByTestId('ai-dialog');
    fireEvent.change(within(dialog).getByLabelText('Что изменить'), { target: { value: 'добавь проверку на null' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Предложить правку' }));
    await within(dialog).findByTestId('ai-diff');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByTestId('ai-dialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(useAppStore.getState().version).toBe(versionBefore);
  }, 20_000);

  it('ai-edit: 409 при «Применить» → сообщение, изменений нет', async () => {
    server.use(scenarios.conflictOnFile);
    await openMergeMethod();

    fireEvent.click(within(varNode()).getByRole('button', { name: /Изменить текстом \(ИИ\)/ }));
    const dialog = screen.getByTestId('ai-dialog');
    fireEvent.change(within(dialog).getByLabelText('Что изменить'), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Предложить правку' }));
    await within(dialog).findByTestId('ai-diff');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Проект изменился');
  }, 20_000);

  it('ai-fix → тот же Quality Gate: POST ai-fix с версией анализа, диалог с вердиктом', async () => {
    const calls = track();
    await openMergeMethod();
    const card = (await screen.findAllByTestId('issue')).find((el) => el.getAttribute('data-issue-id') === issue?.id);
    if (!card) throw new Error('нет карточки');
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Предложить фикс (ИИ)' })).toBeEnabled());

    fireEvent.click(within(card).getByRole('button', { name: 'Предложить фикс (ИИ)' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Исправление подтверждено')).toBeInTheDocument();
    expect(within(dialog).getByText(/Фикс «ИИ»/)).toBeInTheDocument();
    expect(within(dialog).getByTestId('fix-diff')).toHaveTextContent('LinkedHashMap');
    const aiFix = calls.find((c) => c.url.pathname.endsWith('/ai-fix'));
    expect(aiFix?.body).toEqual({ version: analysisJson.version });
    expect(useAppStore.getState().version).toBe(analysisJson.version + 1);
  }, 20_000);

  it('ai-fix 429 → message в диалоге Quality Gate', async () => {
    server.use(...scenarios.aiRateLimited);
    await openMergeMethod();
    const card = (await screen.findAllByTestId('issue')).find((el) => el.getAttribute('data-issue-id') === issue?.id);
    if (!card) throw new Error('нет карточки');
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Предложить фикс (ИИ)' })).toBeEnabled());

    fireEvent.click(within(card).getByRole('button', { name: 'Предложить фикс (ИИ)' }));

    expect(await screen.findByText(fixtures.errorRateLimited.message)).toBeInTheDocument();
  }, 20_000);
});
