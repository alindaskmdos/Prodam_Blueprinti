import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DEMO_DIR, expect, test, versionOf } from './fixtures';

const MERGE_ISSUE = 'NestedLoopSameCollection';
const SLOW = 90_000;

const issueCard = (page: Page, rule: string) => page.getByTestId('issue').filter({ hasText: rule }).first();

/** Выбрать проблему по правилу: открывает метод на схеме. */
async function openIssue(page: Page, rule: string) {
  await issueCard(page, rule).locator('button[aria-pressed]').click();
  await expect(page.getByTestId('method-canvas').first()).toBeVisible();
}

async function openCodeTab(page: Page) {
  await page.getByRole('tab', { name: 'Код Java' }).click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
}

/** Заменить текст ноды: последнее поле редактора (у ноды-переменной тип / имя / значение), Enter применяет. */
async function editNode(page: Page, node: Locator, replace: (old: string) => string) {
  await node.dblclick({ force: true });
  const field = page.getByTestId('node-editor').locator('textarea').last();
  await field.waitFor();
  await field.fill(replace(await field.inputValue()));
  await field.press('Enter');
}

const monacoText = (page: Page) => page.locator('.monaco-editor .view-lines').first();

/** Дождаться, пока transform viewport перестанет меняться (setCenter анимируется ~400 мс), и вернуть его. */
async function settledTransform(page: Page): Promise<string> {
  const viewport = page.locator('.react-flow__viewport').first();
  let prev = '';
  await expect
    .poll(async () => {
      const cur = (await viewport.getAttribute('style')) ?? '';
      const settled = cur === prev;
      prev = cur;
      return settled;
    }, { intervals: [500] })
    .toBe(true);
  return viewport.evaluate((el) => (el as HTMLElement).style.transform);
}

test('загрузка папки: дерево проекта и анализ', async ({ app: page }) => {
  const tree = page.getByTestId('project-tree');
  for (const name of ['merge', 'dispatch', 'distinctIds']) {
    await expect(tree.getByText(name, { exact: true })).toBeVisible();
  }
  await expect.poll(() => versionOf(page)).toBeGreaterThanOrEqual(1);
  await expect(issueCard(page, MERGE_ISSUE)).toBeVisible();
  expect(await page.getByTestId('issue').count()).toBeGreaterThan(3);
});

test('клик по проблеме: схема метода и подсвеченная строка в коде', async ({ app: page }) => {
  await openIssue(page, MERGE_ISSUE);
  await openCodeTab(page);
  await expect(page.getByTestId('node-var').filter({ hasText: 'orders.get(j)' }).first()).toBeVisible();
  await expect(page.locator('.jb-code-highlight').first()).toBeVisible();
});

test('правка ноды: код обновился, версия +1', async ({ app: page }) => {
  await openIssue(page, MERGE_ISSUE);
  await openCodeTab(page);
  const before = await versionOf(page);
  await editNode(page, page.getByTestId('node-var').filter({ hasText: 'orders.get(j)' }).first(), () => 'orders.get(j) /*e2e*/');
  await expect(monacoText(page)).toContainText('/*e2e*/');
  await expect.poll(() => versionOf(page)).toBe(before + 1);
});

test('правка ноды не сдвигает холст (FE-29): transform viewport прежний', async ({ app: page }) => {
  await openIssue(page, MERGE_ISSUE);
  const transformBefore = await settledTransform(page);
  expect(transformBefore).not.toBe('');
  const before = await versionOf(page);
  await editNode(page, page.getByTestId('node-var').filter({ hasText: 'orders.get(j)' }).first(), () => 'orders.get(j + 0)');
  await expect.poll(() => versionOf(page)).toBe(before + 1);
  // Раскладка идёт асинхронно: ждём, пока новый текст ноды появится на холсте, затем проверяем, что viewport не сдвинулся.
  await expect(page.getByTestId('node-var').filter({ hasText: 'orders.get(j + 0)' }).first()).toBeVisible();
  expect(await settledTransform(page)).toBe(transformBefore);
});

test('неверный текст ноды: 422, нода красная, версия прежняя', async ({ app: page }) => {
  await openIssue(page, MERGE_ISSUE);
  const before = await versionOf(page);
  const node = page.getByTestId('node-var').filter({ hasText: 'orders.get(j)' }).first();
  const rejected = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/blocks'));
  await editNode(page, node, () => '= (;');
  expect((await rejected).status()).toBe(422);
  await expect(page.getByText('· ошибка').first()).toBeVisible();
  await page.getByRole('button', { name: 'Отменить правку' }).click();
  await expect(page.getByText('· ошибка')).toHaveCount(0);
  expect(await versionOf(page)).toBe(before);
});

test('фикс index-by-id: Quality Gate подтверждает исправление', async ({ app: page }) => {
  const before = await versionOf(page);
  await issueCard(page, MERGE_ISSUE).getByRole('button', { name: /index-by-id/ }).click();
  await expect(page.getByTestId('fix-verdict')).toContainText('Исправление подтверждено', { timeout: SLOW });
  await page.getByRole('button', { name: 'Оставить и вернуться к схеме' }).click();
  await expect.poll(() => versionOf(page)).toBeGreaterThan(before);
});

test('запуск со STDIN из tests/basic.in: exit code 0', async ({ app: page }) => {
  const stdin = fs.readFileSync(path.join(DEMO_DIR, 'tests/basic.in'), 'utf8');
  const expected = fs.readFileSync(path.join(DEMO_DIR, 'tests/basic.out'), 'utf8');
  await page.getByRole('button', { name: /Запуск/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('textarea').fill(stdin);
  await dialog.getByRole('button', { name: /Запустить/ }).click();
  const result = page.getByLabel('Результат запуска');
  await expect(result).toContainText('exit code 0', { timeout: SLOW });
  await expect(result.locator('pre').first()).toHaveText(expected);
});

test('verify зелёный на неизменённом проекте: 6 пройдено', async ({ app: page }) => {
  await page.getByRole('button', { name: 'Проверить поведение' }).click();
  await expect(page.getByText('Поведение совпадает')).toBeVisible({ timeout: SLOW });
  await expect(page.getByLabel('6 пройдено из 6')).toBeVisible();
});

test('verify красный после правки поведения', async ({ app: page }) => {
  await page.getByTestId('project-tree').getByText('dispatch', { exact: true }).click();
  const node = page.getByTestId('node-expr').filter({ hasText: '"shipped "' }).first();
  await expect(node).toBeAttached();
  // Длинный метод открывается верхом схемы (FE-34): нода может лежать вне экрана — вписываем всю схему.
  await page.locator('.react-flow__controls-fitview').first().click();
  await settledTransform(page);
  const before = await versionOf(page);
  await editNode(page, node, (old) => old.replace('"shipped "', '"SHIPPED! "'));
  await expect.poll(() => versionOf(page)).toBe(before + 1);
  await page.getByRole('button', { name: 'Проверить поведение' }).click();
  await expect(page.getByText(/Поведение отличается — [1-9]\d* из 6/)).toBeVisible({ timeout: SLOW });
});

test('экспорт: .zip и .jar скачиваются', async ({ app: page }) => {
  for (const [button, ext] of [
    ['Скачать .zip', /\.zip$/],
    ['Собрать .jar', /\.jar$/],
  ] as const) {
    await page.getByRole('button', { name: /Экспорт/ }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: SLOW }),
      page.getByRole('button', { name: button }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(ext);
    const file = test.info().outputPath(download.suggestedFilename());
    await download.saveAs(file);
    // zip и jar — zip-архивы: сигнатура «PK».
    expect(fs.readFileSync(file).subarray(0, 2).toString('latin1')).toBe('PK');
    await page.keyboard.press('Escape');
  }
});

test('drag из палитры на стрелку: блок вставлен, код обновился (FE-09)', async ({ app: page }) => {
  await openIssue(page, MERGE_ISSUE);
  await openCodeTab(page);
  const before = await versionOf(page);
  const item = page.getByTestId('palette').locator('[data-kind="comment"]');
  // Схема отцентрирована на проблеме: берём стрелку, лежащую на экране правее палитры и левее миникарты.
  const targets = page.locator('[data-testid^="drop-"]');
  await targets.first().waitFor({ state: 'attached' });
  // Дать схеме осесть: ждём стабильности transform viewport.
  await settledTransform(page);
  const canvas = page.getByTestId('method-canvas').first();
  const area = await canvas.boundingBox();
  if (!area) throw new Error('холст не отрисован');
  let target: Locator | undefined;
  for (const t of await targets.all()) {
    const box = await t.boundingBox();
    if (
      box &&
      box.x > area.x + 300 &&
      box.x < area.x + area.width - 300 &&
      box.y > area.y + 60 &&
      box.y + box.height < area.y + area.height - 20
    ) {
      target = t;
      break;
    }
  }
  if (!target) throw new Error('на холсте нет видимой стрелки для drop');
  await item.dragTo(target, { force: true });
  const field = page.getByTestId('node-editor').locator('textarea').last();
  await field.waitFor();
  // Дать раскладке со вставленным блоком примениться: редактор перестаёт двигаться, viewport стоит.
  const editor = page.getByTestId('node-editor').last();
  let prevBox = '';
  await expect
    .poll(async () => {
      const cur = JSON.stringify(await editor.boundingBox());
      const settled = cur === prevBox;
      prevBox = cur;
      return settled;
    }, { intervals: [500] })
    .toBe(true);
  await settledTransform(page);
  await field.fill('e2e-palette');
  await expect(field).toHaveValue('e2e-palette');
  await field.press('Enter');
  await expect(monacoText(page)).toContainText('e2e-palette');
  await expect.poll(() => versionOf(page)).toBe(before + 1);
});
