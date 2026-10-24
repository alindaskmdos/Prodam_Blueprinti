/** Файл для POST /projects: сам файл и относительный путь (для папки — webkitRelativePath). */
export interface UploadItem {
  file: File;
  /** Путь относительно выбранной папки, напр. `demo/src/Main.java`; для одиночного файла — имя. */
  path: string;
}

/** Файлы из `<input type="file">` (в т.ч. `webkitdirectory` — тогда у файла есть webkitRelativePath). */
export function fromFileList(list: FileList | readonly File[]): UploadItem[] {
  return Array.from(list, (file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/** Содержит ли набор пути с папками — тогда на бэк уходит `paths` (контракт: для webkitdirectory). */
export function hasFolderPaths(items: readonly UploadItem[]): boolean {
  return items.some((i) => i.path.includes('/'));
}

/**
 * Файлы из drop: папки обходятся рекурсивно (webkitGetAsEntry), путь — от перетащенной папки.
 * Entry берутся синхронно в обработчике drop (потом DataTransfer очищается), обход — асинхронно.
 */
export function fromDataTransfer(dt: DataTransfer): Promise<UploadItem[]> {
  const entries: FileSystemEntry[] = [];
  const items = dt.items ? Array.from(dt.items) : [];
  for (const item of items) {
    const entry =
      item.kind === 'file' && typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return Promise.resolve(fromFileList(dt.files));
  return Promise.all(entries.map((e) => walk(e))).then((lists) => lists.flat());
}

async function walk(entry: FileSystemEntry): Promise<UploadItem[]> {
  const path = entry.fullPath.replace(/^\/+/, '') || entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    return [{ file, path }];
  }
  if (entry.isDirectory) {
    const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
    const nested = await Promise.all(children.map((c) => walk(c)));
    return nested.flat();
  }
  return [];
}

/** readEntries отдаёт порциями (до 100) — читать до пустого ответа. */
async function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

/** «48 КБ», «1,2 МБ». */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}
