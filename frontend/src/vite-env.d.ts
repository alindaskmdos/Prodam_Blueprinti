/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' — запросы /api обслуживает MSW на contract/fixtures; иначе — прокси на бэкенд. */
  readonly VITE_USE_MOCKS?: string;
  /** Адрес бэкенда для dev-прокси (по умолчанию http://localhost:8080). */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
