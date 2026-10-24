import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import analysisJson from '@contract/fixtures/analysis.merge.json';
import treeJson from '@contract/fixtures/tree.json';
import { createApiClient } from '../features/api';
import { resetAnalysisState, useAnalysisStore } from '../features/analysis-panel';
import { resetFixState } from '../features/fix';
import { resetTreeState } from '../features/project-tree';
import { HEALTH_RETRY_MS, resetSandboxState, useSandboxStore } from '../features/sandbox';
import { resetTestsState, useTestsStore } from '../features/tests-panel';
import { server } from '../mocks/server';
import { fixtures } from '../mocks/fixtures';
import { scenarios } from '../mocks/handlers';
import { App } from './App';
import { findCommand } from './commands';
import { resetAppState, useAppStore } from './store';

const API = '*/api';
const client = createApiClient('http://localhost/api');
const issue = analysisJson.issues.find((i) => i.fixes.length > 0);
if (!issue) throw new Error('analysis.merge.json: нужна проблема с фиксом');
const fixId = issue.fixes[0] ?? '';

/** Счётчик GET tree и тела POST fix. */
function track() {
  const state = { treeLoads: 0, fixBodies: [] as unknown[], runBodies: [] as unknown[] };
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.endsWith('/tree')) state.treeLoads += 1;
    if (request.method === 'POST' && url.pathname.endsWith('/fix')) {
      void request.clone().json().then((b: unknown) => state.fixBodies.push(b));
    }
    if (request.method === 'POST' && url.pathname.endsWith('/run')) {
      void request.clone().json().then((b: unknown) => state.runBodies.push(b));
    }
  });
  return state;
}

function renderApp() {
  return render(<App client={client} projectId="p-1" canvas={<div>холст</div>} />);
}

/** Карточка проблемы с фиксом и кнопка «Применить» у её фикса (id — из Issue.fixes). */
async function applyButton() {
  const card = (await screen.findAllByTestId('issue')).find((el) => el.getAttribute('data-issue-id') === issue?.id);
  if (!card) throw new Error('нет карточки');
  return within(card).getByRole('button', { name: new RegExp(`${fixId}.*Применить`) });
}

/** Песочница привязана и /health ответил. */
async function sandboxReady() {
  await waitFor(() => expect(useSandboxStore.getState().docker).not.toBeNull());
  await waitFor(() => expect(useSandboxStore.getState().mainClasses).not.toBeNull());
}

beforeEach(() => {
  resetAppState();
  resetTreeState();
  resetAnalysisState();
  resetTestsState();
  resetSandboxState();
  resetFixState();
});
afterEach(() => {
  server.events.removeAllListeners();
});

describe('FE-13: применить фикс (Quality Gate)', () => {
  it('applied → версия растёт, анализ из ответа, дерево перезагружено, diff и «подтверждено»', async () => {
    const t = track();
    renderApp();
    await waitFor(() => expect(useAppStore.getState().version).toBe(treeJson.version));
    await sandboxReady();
    const loadsBefore = t.treeLoads;
    const button = await applyButton();
    expect(button).toBeEnabled();

    fireEvent.click(button);

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Исправление подтверждено')).toBeInTheDocument();
    // Версия и fixId: из анализа (Issue.id действителен для его версии) и Issue.fixes, а не захардкоженные.
    expect(t.fixBodies).toEqual([{ version: analysisJson.version, fixId }]);
    expect(useAppStore.getState().version).toBe(analysisJson.version + 1);
    expect(useAnalysisStore.getState().analysis?.version).toBe(analysisJson.version + 1);
    await waitFor(() => expect(t.treeLoads).toBeGreaterThan(loadsBefore));
    // Unified diff из ответа: добавленные/удалённые строки.
    const diff = within(dialog).getByTestId('fix-diff');
    expect(diff.querySelectorAll('[data-kind="add"]').length).toBeGreaterThan(0);
    expect(diff.querySelectorAll('[data-kind="del"]').length).toBeGreaterThan(0);
    expect(diff).toHaveTextContent('LinkedHashMap');
    // Оценка — «≈… → ≈… операций при n = …» с подписью «асимптотическая оценка».
    expect(within(dialog).getByTestId('fix-ops')).toHaveTextContent(/≈.*→.*≈.*операций при n = 10 000/);
    expect(within(dialog).getByText(/асимптотическая оценка/)).toBeInTheDocument();
    expect(useTestsStore.getState().verify?.status).toBe('green');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Оставить и вернуться к схеме' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rejected → «не подтверждено» с причиной, версия прежняя, результаты тестов в панели', async () => {
    server.use(scenarios.fixRejected);
    renderApp();
    await waitFor(() => expect(useAppStore.getState().version).toBe(treeJson.version));
    await sandboxReady();
    const versionBefore = useAppStore.getState().version;

    fireEvent.click(await applyButton());

    const verdict = await screen.findByTestId('fix-verdict');
    expect(verdict).toHaveTextContent('Исправление не подтверждено');
    expect(verdict).toHaveTextContent('тест merge не проходит после фикса');
    expect(verdict).toHaveAttribute('role', 'alert');
    expect(verdict.className).toMatch(/shake/);
    expect(useAppStore.getState().version).toBe(versionBefore);
    expect(useTestsStore.getState().verify?.status).toBe('red');
    // Шаг IO-тестов провален.
    const failed = screen.getAllByRole('listitem').filter((li) => li.getAttribute('data-status') === 'fail');
    expect(failed.map((li) => li.textContent)).toEqual([expect.stringContaining('IO-тесты')]);

    fireEvent.click(within(verdict).getByRole('button', { name: 'Показать diff вывода' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useAppStore.getState().activePanels.bottom).toBe('bottom.tests');
  });

  it('rejected без verify → шаги не угадываются, причина сервера дословно', async () => {
    const reason = 'исправление не подтверждено: код не компилируется после фикса: OrderService.java:40';
    server.use(
      http.post(`${API}/projects/:projectId/issues/:issueId/fix`, () =>
        HttpResponse.json({ applied: false, version: analysisJson.version, reason }),
      ),
    );
    renderApp();
    await sandboxReady();
    fireEvent.click(await applyButton());
    expect(await screen.findByTestId('fix-reason')).toHaveTextContent(reason);
    const steps = within(screen.getByRole('dialog')).getAllByRole('listitem');
    expect(steps.map((li) => li.getAttribute('data-status'))).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    expect(steps.every((li) => li.textContent?.includes('сервер не детализировал шаги'))).toBe(true);
  });

  it('applied без verify → «подтверждено» не показывается, тестовые шаги не детализированы', async () => {
    server.use(
      http.post(`${API}/projects/:projectId/issues/:issueId/fix`, async ({ request }) => {
        const { version } = (await request.json()) as { version: number };
        return HttpResponse.json({ applied: true, version: version + 1, diff: fixtures.fixApplied.diff });
      }),
    );
    renderApp();
    await sandboxReady();
    fireEvent.click(await applyButton());
    const verdict = await screen.findByTestId('fix-verdict');
    expect(verdict).toHaveTextContent('Применено, проверка неполная');
    expect(verdict).not.toHaveTextContent('поведение совпадает');
    const steps = within(screen.getByRole('dialog')).getAllByRole('listitem');
    expect(steps.map((li) => li.getAttribute('data-status'))).toEqual(['ok', 'ok', 'unknown', 'unknown']);
  });

  it('кнопка «Применить» идёт через команду fix.apply с issueId/fixId', async () => {
    const t = track();
    renderApp();
    await waitFor(() => expect(useAnalysisStore.getState().analysis).not.toBeNull());
    await sandboxReady();
    expect(findCommand('fix.apply')?.isEnabled?.()).toBe(true);
    await act(async () => {
      await findCommand('fix.apply')?.run({ issueId: issue.id, fixId });
    });
    expect(await screen.findByText('Исправление подтверждено')).toBeInTheDocument();
    expect(t.fixBodies).toEqual([{ version: analysisJson.version, fixId }]);
  });

  it('incomplete (тестов нет) → применено с пометкой', async () => {
    server.use(scenarios.fixIncomplete);
    renderApp();
    await sandboxReady();
    fireEvent.click(await applyButton());
    const verdict = await screen.findByTestId('fix-verdict');
    expect(verdict).toHaveTextContent('Применено, проверка неполная');
    expect(verdict).toHaveTextContent('подтверждена компиляция, тестов нет');
    expect(useAppStore.getState().version).toBe(analysisJson.version + 1);
  });

  it('409 → тост, диалог закрыт, версия перезагружена из GET project', async () => {
    server.use(
      scenarios.fixConflict,
      http.get(`${API}/projects/:projectId`, () => HttpResponse.json({ ...fixtures.project, version: 7 })),
    );
    renderApp();
    await sandboxReady();
    fireEvent.click(await applyButton());
    expect(await screen.findByTestId('fix-conflict')).toHaveTextContent('Фикс не применён');
    await waitFor(() => expect(useAppStore.getState().version).toBe(7));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('нет Docker (/health) → «Применить», «Запуск» и «Проверить поведение» неактивны', async () => {
    server.use(scenarios.noDocker);
    renderApp();
    await waitFor(() => expect(useSandboxStore.getState().docker).toBe(false));
    expect(await applyButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: '▶ Запуск' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Проверить поведение' })).toBeDisabled();
    expect(screen.getByText('Песочница недоступна')).toBeInTheDocument();
    expect(findCommand('project.verify')?.isEnabled?.()).toBe(false);
  });
});

describe('FE-13: запуск и проверка поведения', () => {
  it('запуск: один main — stdin уходит в POST run, результат в панели тестов', async () => {
    const t = track();
    renderApp();
    await sandboxReady();
    fireEvent.click(screen.getByRole('button', { name: '▶ Запуск' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('com.demo.Main')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '2\n' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Запустить/ }));

    await waitFor(() => expect(useTestsStore.getState().run).toEqual(fixtures.runOk));
    expect(t.runBodies).toEqual([{ mainClass: 'com.demo.Main', stdin: '2\n' }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useAppStore.getState().activePanels.bottom).toBe('bottom.tests');
    const tab = screen.getByRole('tab', { name: 'Результат тестов' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  it('запуск: несколько main — выбор обязателен, выбранный mainClass уходит в запрос', async () => {
    const t = track();
    server.use(scenarios.projectTwoMains);
    renderApp();
    await sandboxReady();
    fireEvent.click(screen.getByRole('button', { name: '▶ Запуск' }));
    const dialog = await screen.findByRole('dialog');
    const run = within(dialog).getByRole('button', { name: /Запустить/ });
    expect(run).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'com.demo.tools.Seed' } });
    expect(run).toBeEnabled();
    fireEvent.click(run);
    await waitFor(() => expect(useTestsStore.getState().run).not.toBeNull());
    expect(t.runBodies).toEqual([{ mainClass: 'com.demo.tools.Seed', stdin: '' }]);
  });

  it('запуск: 422 AMBIGUOUS_MAIN → выбор из details.mainClasses и повтор', async () => {
    const t = track();
    server.use(
      scenarios.runAmbiguousMain,
      http.get(`${API}/projects/:projectId`, () => HttpResponse.json({ ...fixtures.project, mainClasses: [] })),
    );
    renderApp();
    await sandboxReady();
    fireEvent.click(screen.getByRole('button', { name: '▶ Запуск' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Запустить/ }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('выберите точку входа');
    const select = within(dialog).getByRole('combobox');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toContain('com.demo.tools.Seed');
    fireEvent.change(select, { target: { value: 'com.demo.Main' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(useTestsStore.getState().run).toEqual(fixtures.runOk));
    expect(t.runBodies).toEqual([{ stdin: '' }, { mainClass: 'com.demo.Main', stdin: '' }]);
  });

  it('проверка: red → результат в панели тестов, вкладка переключена; во время прогона кнопки заблокированы', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    server.use(
      http.post(`${API}/projects/:projectId/verify`, async () => {
        await gate;
        return HttpResponse.json(fixtures.verifyRed);
      }),
    );
    renderApp();
    await sandboxReady();
    const verify = screen.getByRole('button', { name: 'Проверить поведение' });
    fireEvent.click(verify);

    expect(await screen.findByText('Проверка…')).toBeInTheDocument();
    expect(verify).toBeDisabled();
    expect(screen.getByRole('button', { name: '▶ Запуск' })).toBeDisabled();
    expect(await applyButton()).toBeDisabled();

    release();
    await waitFor(() => expect(useTestsStore.getState().verify).toEqual(fixtures.verifyRed));
    expect(screen.getByRole('tab', { name: 'Результат тестов' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(verify).toBeEnabled());
  });

  it('проверка: 503 → «песочница недоступна», кнопки неактивны; health с Docker снова включает', async () => {
    server.use(scenarios.verifyUnavailable);
    renderApp();
    await sandboxReady();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить поведение' }));

    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Песочница недоступна');
    expect(toast).toHaveTextContent('Docker недоступен');
    expect(screen.getByRole('button', { name: '▶ Запуск' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Проверить поведение' })).toBeDisabled();
    expect(await applyButton()).toBeDisabled();

    fireEvent.click(within(toast).getByRole('button', { name: 'Проверить снова' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Проверить поведение' })).toBeEnabled());
  });

  it('503 → опрос /health раз в 15 с, пока недоступна; при успехе опрос останавливается', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let docker = true;
      let healthCalls = 0;
      server.use(
        scenarios.verifyUnavailable,
        http.get(`${API}/health`, () => {
          healthCalls += 1;
          return HttpResponse.json({ status: 'UP', docker, llm: false });
        }),
      );
      renderApp();
      await sandboxReady();
      const verifyButton = screen.getByRole('button', { name: 'Проверить поведение' });
      fireEvent.click(verifyButton);
      await waitFor(() => expect(verifyButton).toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
      // Кнопка «Проверить снова» есть и в шапке (тост закрыт).
      expect(screen.getByRole('button', { name: 'Проверить снова' })).toBeInTheDocument();

      docker = false;
      const before = healthCalls;
      await act(() => vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS));
      await waitFor(() => expect(healthCalls).toBe(before + 1));
      expect(verifyButton).toBeDisabled();

      docker = true;
      await act(() => vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS));
      await waitFor(() => expect(verifyButton).toBeEnabled());
      const afterRecovery = healthCalls;
      await act(() => vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS * 3));
      expect(healthCalls).toBe(afterRecovery);
    } finally {
      vi.useRealTimers();
    }
  });

  it('запуск: 503 → песочница недоступна', async () => {
    server.use(scenarios.runUnavailable);
    renderApp();
    await sandboxReady();
    fireEvent.click(screen.getByRole('button', { name: '▶ Запуск' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Запустить/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Песочница недоступна');
    expect(screen.getByRole('button', { name: '▶ Запуск' })).toBeDisabled();
  });

  it('проверка: 422 AMBIGUOUS_MAIN → сообщение со списком main', async () => {
    server.use(scenarios.verifyAmbiguousMain);
    renderApp();
    await sandboxReady();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить поведение' }));
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Проверка невозможна');
    expect(toast).toHaveTextContent('com.demo.tools.Seed');
    expect(screen.getByRole('button', { name: 'Проверить поведение' })).toBeEnabled();
  });

  it('команды project.run / project.verify есть в реестре', async () => {
    renderApp();
    await sandboxReady();
    expect(findCommand('project.run')?.isEnabled?.()).toBe(true);
    expect(findCommand('project.verify')?.isEnabled?.()).toBe(true);
  });
});
