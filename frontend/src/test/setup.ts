import '@testing-library/jest-dom/vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../mocks/server';

// vitest (jsdom) подменяет FormData/File/Blob на jsdom-версии, а Request/fetch остаются Node-овскими:
// undici (Node ≥ 24) не узнаёт jsdom FormData и отправляет его строкой text/plain.
// Возвращаем Node-овские FormData/File/Blob (FormData берём у Response.formData()) — как в браузере, где всё из одного мира.
const NodeFormData = (await new Response('', { headers: { 'content-type': 'application/x-www-form-urlencoded' } }).formData()).constructor;
Object.assign(globalThis, { FormData: NodeFormData, File: NodeFile, Blob: NodeBlob });

// Node ≥ 25 даёт глобальный localStorage-геттер, который без --localstorage-file возвращает undefined
// и перекрывает jsdom-овский Storage. Если хранилище недоступно — подставляем рабочее in-memory (как в браузере).
function installStorage(name: 'localStorage' | 'sessionStorage') {
  let usable = false;
  try {
    usable = typeof globalThis[name]?.getItem === 'function';
  } catch {
    usable = false;
  }
  if (usable) return;
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(String(k)) ?? null,
    setItem: (k: string, v: string) => void data.set(String(k), String(v)),
    removeItem: (k: string) => void data.delete(String(k)),
    clear: () => data.clear(),
  } as Storage;
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
}
installStorage('localStorage');
installStorage('sessionStorage');

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
