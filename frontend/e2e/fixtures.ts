import path from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

export const DEMO_DIR = path.resolve(import.meta.dirname, '../../samples/demo');

/** Номер версии из шапки «имя · версия N». */
export async function versionOf(page: Page): Promise<number> {
  const label = (await page.getByTestId('project-label').textContent()) ?? '';
  const m = /версия (\d+)/.exec(label);
  if (!m) throw new Error(`версия не найдена в «${label}»`);
  return Number(m[1]);
}

/**
 * `app` — страница с загруженным samples/demo (каждый тест грузит проект заново).
 * После теста падает, если были pageerror или HTTP 5xx от /api (4xx — штатные 409/422 — не считаются).
 */
export const test = base.extend<{ app: Page }>({
  app: async ({ page }, run) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 500) {
        problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
      }
    });
    await page.goto('/');
    await page.locator('input[webkitdirectory]').setInputFiles(DEMO_DIR);
    await expect(page.getByTestId('project-tree')).toBeVisible();
    // Анализ приходит вместе с проектом: ждём первую проблему.
    await expect(page.getByTestId('issue').first()).toBeVisible();
    await run(page);
    expect(problems, 'pageerror / HTTP 5xx во время теста').toEqual([]);
  },
});

export { expect };
