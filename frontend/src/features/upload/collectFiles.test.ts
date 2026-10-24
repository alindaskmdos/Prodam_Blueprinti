import { describe, expect, it } from 'vitest';
import { formatSize, fromDataTransfer } from './collectFiles';

function fileEntry(fullPath: string): FileSystemFileEntry {
  const name = fullPath.split('/').pop() ?? fullPath;
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (ok: (f: File) => void) => ok(new File(['x'], name)),
  } as unknown as FileSystemFileEntry;
}

function dirEntry(fullPath: string, children: FileSystemEntry[]): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name: fullPath.split('/').pop() ?? fullPath,
    fullPath,
    createReader: () => {
      // Отдаём порциями по одному, затем пустой ответ — как readEntries в браузере.
      const queue = [...children];
      return { readEntries: (ok: (e: FileSystemEntry[]) => void) => ok(queue.splice(0, 1)) };
    },
  } as unknown as FileSystemDirectoryEntry;
}

describe('fromDataTransfer', () => {
  it('рекурсивно обходит перетащенную папку и сохраняет относительные пути', async () => {
    const root = dirEntry('/demo', [
      fileEntry('/demo/Main.java'),
      dirEntry('/demo/tests', [fileEntry('/demo/tests/a.json'), fileEntry('/demo/tests/a.in')]),
    ]);
    const dt = {
      items: [{ kind: 'file', webkitGetAsEntry: () => root }],
      files: [],
    } as unknown as DataTransfer;

    const items = await fromDataTransfer(dt);
    expect(items.map((i) => i.path)).toEqual(['demo/Main.java', 'demo/tests/a.json', 'demo/tests/a.in']);
    expect(items[0]?.file.name).toBe('Main.java');
  });

  it('без entries берёт dataTransfer.files', async () => {
    const file = new File(['x'], 'A.java');
    const items = await fromDataTransfer({ items: [], files: [file] } as unknown as DataTransfer);
    expect(items).toEqual([{ file, path: 'A.java' }]);
  });
});

describe('formatSize', () => {
  it('Б / КБ / МБ', () => {
    expect(formatSize(500)).toBe('500 Б');
    expect(formatSize(48 * 1024)).toBe('48 КБ');
    expect(formatSize(1.25 * 1024 * 1024)).toBe('1,3 МБ');
  });
});
