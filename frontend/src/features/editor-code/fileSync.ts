import type { ApiClient, Schemas } from '../api';

/** Задержка между последней правкой и PUT files (ТЗ §5, frontend/CLAUDE.md). */
export const SYNC_DEBOUNCE_MS = 500;

export type FileSyncStatus =
  /** GET files в процессе (первая загрузка или перезагрузка после 409). */
  | 'loading'
  /** Текст в редакторе принят сервером. */
  | 'synced'
  /** Есть правка, ждём debounce. */
  | 'pending'
  /** PUT files в процессе. */
  | 'saving'
  /** 422 PARSE_ERROR: правка не применена, граф прежний. */
  | 'parse-error'
  /** Прочая ошибка (404, 5xx, сеть). */
  | 'error';

export interface ParseError {
  /** Строка с 1 (Error.line), если сервер её указал. */
  line?: number;
  message: string;
}

export interface ConflictInfo {
  clientVersion?: number;
  serverVersion?: number;
  message: string;
  /** Растёт на каждый 409 — чтобы показать тост повторно. */
  seq: number;
}

/**
 * Файл изменился извне (правка нод, фикс), пока у пользователя были неотправленные правки.
 * В редакторе уже новый серверный текст; правки пользователя сохранены здесь и не отправлены.
 */
export interface StaleEdit {
  /** Текст пользователя, который не ушёл на сервер. */
  text: string;
}

export interface FileSyncState {
  status: FileSyncStatus;
  /** Версия проекта, с которой уйдёт следующий PUT. */
  version: number | null;
  /** Текст, загруженный GET files. Редактор подменяет содержимое, когда меняется loadSeq. */
  loadedText: string | null;
  loadSeq: number;
  parseError: ParseError | null;
  error: string | null;
  conflict: ConflictInfo | null;
  /** Неотправленные правки, отложенные из-за внешней смены версии: «Взять новый текст» / «Оставить мои». */
  stale: StaleEdit | null;
}

export interface FileSyncOptions {
  client: ApiClient;
  projectId: string;
  path: string;
  debounceMs?: number;
  /** Новая версия проекта (после GET files и каждого принятого PUT). */
  onVersion?: (version: number) => void;
  /** Принятая правка: новое дерево и анализ для остальных панелей. */
  onMutation?: (result: Schemas['MutationResult']) => void;
  /** 409: проект изменён, приложению стоит перезагрузить своё состояние. */
  onConflict?: (error: Schemas['Error']) => void;
}

type Listener = () => void;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/**
 * Синхронизация текста одного файла с бэкендом, без Monaco и React.
 * Правка → debounce → PUT files с полным текстом и текущей версией; одновременно в полёте
 * не больше одного запроса. 409 → перезагрузка текста, 422 → parseError без смены версии.
 */
export class FileSync {
  private state: FileSyncState = {
    status: 'loading',
    version: null,
    loadedText: null,
    loadSeq: 0,
    parseError: null,
    error: null,
    conflict: null,
    stale: null,
  };
  private readonly listeners = new Set<Listener>();
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Последний текст, который точно лежит на сервере. */
  private serverText: string | null = null;
  /** Правка, ещё не отправленная. */
  private pendingText: string | null = null;
  /** Текст, который сейчас в редакторе (последний из load/edit/keepMine). */
  private localText: string | null = null;
  /** Самая новая версия, пришедшая извне (adoptVersion). */
  private externalVersion: number | null = null;
  /** externalVersion на момент последнего GET files: его ответ уже учитывает эту версию. */
  private caughtUp: number | null = null;
  private inFlight: Promise<void> | null = null;
  /** Растёт на каждую (пере)загрузку: ответы на запросы старых поколений игнорируются. */
  private generation = 0;
  private disposed = false;

  constructor(private readonly options: FileSyncOptions) {
    this.debounceMs = options.debounceMs ?? SYNC_DEBOUNCE_MS;
  }

  getState = (): FileSyncState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** GET files: текст и версия. Сбрасывает неотправленные правки (stale-черновик не трогает). */
  load(): Promise<void> {
    this.clearTimer();
    this.pendingText = null;
    this.caughtUp = this.externalVersion;
    const gen = ++this.generation;
    this.set({ status: 'loading', error: null, parseError: null });
    const { client, projectId, path } = this.options;
    const p = client
      .GET('/projects/{projectId}/files', { params: { path: { projectId }, query: { path } } })
      .then(({ data, error, response }) => {
        if (this.isStale(gen)) return;
        if (data) {
          this.serverText = data.text;
          this.localText = data.text;
          this.set({
            status: 'synced',
            version: data.version,
            loadedText: data.text,
            loadSeq: this.state.loadSeq + 1,
          });
          this.options.onVersion?.(data.version);
        } else {
          this.set({ status: 'error', error: error?.message ?? `HTTP ${response.status}` });
        }
      })
      .catch((e: unknown) => {
        if (!this.isStale(gen)) this.set({ status: 'error', error: errorMessage(e) });
      });
    this.inFlight = p.finally(() => {
      if (this.generation !== gen) return;
      this.inFlight = null;
      // Внешняя версия выросла во время загрузки — догнать.
      this.reconcile();
    });
    return this.inFlight;
  }

  /** Новый полный текст из редактора. */
  edit(text: string): void {
    if (this.disposed || this.state.status === 'loading') return;
    this.localText = text;
    if (text === this.serverText && !this.inFlight) {
      // Вернули текст к принятому сервером — отправлять нечего.
      this.clearTimer();
      this.pendingText = null;
      this.set({ status: 'synced', parseError: null, error: null });
      return;
    }
    this.pendingText = text;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
    if (!this.inFlight) this.set({ status: 'pending' });
  }

  /**
   * Версия проекта стала известна извне (правка нод, фикс). Новее нашей — текст файла мог измениться:
   * перезагружаем его (GET files), а не подменяем только версию — иначе следующий PUT со старым текстом
   * и свежей версией затёр бы чужую правку. Неотправленные правки не уходят, а откладываются в `stale`.
   * PUT в полёте — проверим после ответа.
   */
  adoptVersion(version: number): void {
    if (this.externalVersion !== null && version <= this.externalVersion) return;
    this.externalVersion = version;
    this.reconcile();
  }

  /** stale → «Взять новый текст»: правки пользователя отброшены, в редакторе уже серверный текст. */
  takeTheirs(): void {
    if (this.state.stale) this.set({ stale: null });
  }

  /**
   * stale → «Оставить мои»: вернуть текст пользователя в редактор и отправить его с актуальной версией
   * (осознанная перезапись изменений извне).
   */
  keepMine(): void {
    const { stale, status } = this.state;
    if (!stale || status === 'loading' || this.disposed) return;
    const text = stale.text;
    this.localText = text;
    this.clearTimer();
    this.set({ stale: null, loadedText: text, loadSeq: this.state.loadSeq + 1 });
    if (text === this.serverText) {
      this.pendingText = null;
      if (!this.inFlight) this.set({ status: 'synced', parseError: null, error: null });
      return;
    }
    this.pendingText = text;
    if (this.inFlight) return; // уйдёт после ответа (afterRequest)
    this.set({ status: 'pending' });
    this.flush();
  }

  dismissConflict(): void {
    if (this.state.conflict) this.set({ conflict: null });
  }

  /** Промис, который завершается, когда нет запроса в полёте (для тестов и ожиданий). */
  async idle(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.listeners.clear();
  }

  private flush(): void {
    if (this.disposed || this.inFlight || this.pendingText === null) return;
    if (this.needsCatchUp()) {
      // Нельзя отправлять текст на основе устаревшей версии.
      this.reconcile();
      return;
    }
    const version = this.state.version;
    if (version === null) return;
    const text = this.pendingText;
    this.pendingText = null;
    const gen = this.generation;
    this.set({ status: 'saving' });
    const { client, projectId, path } = this.options;
    const p = client
      .PUT('/projects/{projectId}/files', {
        params: { path: { projectId }, query: { path } },
        body: { version, text },
      })
      .then(({ data, error, response }): 'reload' | undefined => {
        if (this.isStale(gen)) return;
        if (data) {
          this.serverText = data.fileText;
          this.set({ version: data.version, parseError: null, error: null });
          this.options.onVersion?.(data.version);
          this.options.onMutation?.(data);
          return;
        }
        if (response.status === 409) {
          const err: Schemas['Error'] = error ?? { code: 'VERSION_CONFLICT', message: 'HTTP 409' };
          this.set({
            conflict: {
              clientVersion: asNumber(err.details?.clientVersion),
              serverVersion: asNumber(err.details?.serverVersion),
              message: err.message,
              seq: (this.state.conflict?.seq ?? 0) + 1,
            },
          });
          this.options.onConflict?.(err);
          return 'reload';
        }
        if (response.status === 422 && error) {
          this.set({ parseError: { line: error.line, message: error.message }, error: null });
          return;
        }
        this.set({ error: error?.message ?? `HTTP ${response.status}` });
      })
      .catch((e: unknown): undefined => {
        if (!this.isStale(gen)) this.set({ error: errorMessage(e) });
        return undefined;
      });

    this.inFlight = p.then((outcome) => {
      if (this.isStale(gen)) return;
      this.inFlight = null;
      if (outcome === 'reload') {
        return this.load();
      }
      this.afterRequest();
    });
  }

  /** После ответа PUT: отправить накопленную правку или выставить итоговый статус. */
  private afterRequest(): void {
    if (this.needsCatchUp()) {
      this.reconcile();
      return;
    }
    if (this.pendingText !== null) {
      if (this.timer) this.set({ status: 'pending' });
      else this.flush();
      return;
    }
    if (this.state.parseError) this.set({ status: 'parse-error' });
    else if (this.state.error) this.set({ status: 'error' });
    else this.set({ status: 'synced' });
  }

  /** Есть внешняя версия новее нашей, которую ещё не учёл ни один GET files. */
  private needsCatchUp(): boolean {
    const ext = this.externalVersion;
    if (ext === null) return false;
    if (this.state.version !== null && ext <= this.state.version) return false;
    return this.caughtUp === null || ext > this.caughtUp;
  }

  /**
   * Догнать внешнюю версию, когда нет запроса в полёте: таймер отменяется, неотправленный текст
   * (pending, отклонённый 422 или упавший PUT) откладывается в `stale`, затем GET files.
   */
  private reconcile(): void {
    if (this.disposed || this.inFlight || !this.needsCatchUp()) return;
    this.clearTimer();
    this.pendingText = null;
    const unsent = this.localText !== null && this.localText !== this.serverText ? this.localText : null;
    if (unsent !== null) this.set({ stale: { text: unsent } });
    void this.load();
  }

  private isStale(gen: number): boolean {
    return this.disposed || gen !== this.generation;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private set(patch: Partial<FileSyncState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
}
