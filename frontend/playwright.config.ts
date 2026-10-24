import { defineConfig } from '@playwright/test';

// e2e на реальном бэкенде, без моков. Адрес фронта — E2E_BASE_URL (по умолчанию dev-сервер Vite).
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // Один воркер: бэкенд собирает и запускает код в Docker, параллельные прогоны только мешают друг другу.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
