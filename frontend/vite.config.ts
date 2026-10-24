import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

const contractDir = fileURLToPath(new URL('../contract', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:8080';

  return {
    plugins: [react()],
    resolve: {
      alias: { '@contract': contractDir },
      // Только в vitest: в node-условии react-resizable-panels отдаёт серверную сборку (раскладка не считается, collapse() падает).
      ...(process.env.VITEST ? { conditions: ['browser'] } : {}),
    },
    server: {
      port: 5173,
      // Моки импортируют ../contract/fixtures/*.json.
      fs: { allow: ['.', contractDir] },
      // Без моков (VITE_USE_MOCKS=false) запросы /api уходят на бэкенд (он сам слушает /api/...).
      proxy: {
        '/api': { target: backendUrl, changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // В node-условии пакет отдаёт серверную сборку (раскладка панелей не считается, collapse()/expand() падают) — берём браузерную.
      server: { deps: { inline: ['react-resizable-panels'] } },
      // e2e/ — Playwright (npm run e2e), vitest их не запускает.
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
  };
});
