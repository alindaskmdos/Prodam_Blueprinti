import type { ApiClient, Schemas } from '../api';
import { hasFolderPaths, type UploadItem } from './collectFiles';

export type UploadResult =
  | { ok: true; project: Schemas['Project'] }
  | { ok: false; status: number | null; error: Schemas['Error'] | null };

/** POST /projects (multipart): `files` и, для папки, `paths` в том же порядке. */
export async function uploadProject(client: ApiClient, items: readonly UploadItem[]): Promise<UploadResult> {
  const form = buildUploadForm(items);
  try {
    const { data, error, response } = await client.POST('/projects', {
      // Тело — FormData выше; поле body нужно только для типов openapi-fetch.
      body: { files: [] },
      bodySerializer: () => form,
    });
    if (data) return { ok: true, project: data };
    return { ok: false, status: response.status, error: asError(error) };
  } catch {
    return { ok: false, status: null, error: null };
  }
}

/** Тело POST /projects: `files` по порядку; `paths` в том же порядке — только если есть папки (webkitdirectory). */
export function buildUploadForm(items: readonly UploadItem[]): FormData {
  const form = new FormData();
  for (const item of items) form.append('files', item.file, item.file.name);
  if (hasFolderPaths(items)) for (const item of items) form.append('paths', item.path);
  return form;
}

export type ExportResult =
  | { ok: true; blob: Blob; filename: string }
  | { ok: false; status: number | null; error: Schemas['Error'] | null };

export type ExportRequest = { format: 'zip'; includeSettings: boolean } | { format: 'jar'; mainClass?: string };

/** GET /projects/{id}/export → файл. Ошибки: 404, 422 (jar не компилируется), 501 (jar пока не реализован на бэке). */
export async function exportProject(
  client: ApiClient,
  projectId: string,
  req: ExportRequest,
): Promise<ExportResult> {
  const query =
    req.format === 'zip'
      ? { format: req.format, includeSettings: req.includeSettings }
      : { format: req.format, ...(req.mainClass ? { mainClass: req.mainClass } : {}) };
  try {
    const { data, error, response } = await client.GET('/projects/{projectId}/export', {
      params: { path: { projectId }, query },
      parseAs: 'blob',
    });
    if (response.ok && data) {
      const filename = filenameFrom(response.headers.get('Content-Disposition')) ?? `${projectId}.${req.format}`;
      return { ok: true, blob: data, filename };
    }
    return { ok: false, status: response.status, error: asError(error) };
  } catch {
    return { ok: false, status: null, error: null };
  }
}

/** `attachment; filename="demo.zip"` → `demo.zip`. */
export function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // ниже — обычный filename
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim() ?? null;
}

function asError(value: unknown): Schemas['Error'] | null {
  if (value && typeof value === 'object' && 'code' in value && 'message' in value) return value as Schemas['Error'];
  return null;
}
