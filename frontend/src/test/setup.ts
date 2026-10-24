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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
