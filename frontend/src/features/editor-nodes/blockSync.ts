import type { ApiClient, Schemas } from '../api';
import { blockAt, draftOf, editableFields, findPathById, mergeFields, sameFields, withFields, type BlockPath } from './blockEdit';

export type BlockSyncStatus =
  /** GET blocks в процессе (первая загрузка или перезагрузка после 409). */
  | 'loading'
  /** Дерево с сервера показано, правки возможны. */
  | 'ready'
  /** PUT blocks в процессе. */
  | 'saving'
  /** Метод не загрузился. */
  | 'error';

/** 422 PARSE_ERROR: правка не применена, на сервере старое дерево. */
export interface InvalidEdit {
  /** Нода, которую правили: показывается с введённым текстом. */
  path: BlockPath;
  /** Введённые значения полей (черновик). */
  draft: Record<string, string>;
  /** Нода, которую указал сервер (Error.blockId); не нашлась — та, что правили. */
  errorPath: BlockPath;
  blockId?: string;
  message: string;
}

export interface ConflictInfo {
  clientVersion?: number;
  serverVersion?: number;
  message: string;
  /** Растёт на каждый 409 — чтобы показать тост повторно. */
  seq: number;
}

export interface BlockSyncState {
  status: BlockSyncStatus;
  /** Метод в том виде, как он лежит на сервере. */
  view: Schemas['MethodView'] | null;
  /** Версия проекта, с которой уйдёт следующий PUT. */
  version: number | null;
  /** Путь ноды, открытой в инлайн-редакторе. */
  editing: BlockPath | null;
  invalid: InvalidEdit | null;
  /** Ошибка загрузки или прочая ошибка PUT (404, 5xx, сеть). */
  error: string | null;
  conflict: ConflictInfo | null;
  /**
   * Пока был открыт редактор, версия проекта выросла извне (правка кода, фикс): дерево на экране устарело.
   * Применять черновик к старому дереву нельзя (затрёт чужую правку) — только rebase (к новому дереву) или отмена.
   */
  stale: boolean;
}

export interface BlockSyncOptions {
  client: ApiClient;
  projectId: string;
  methodId: string;
  /** Версия, известная приложению на старте. Нет — берётся из GET /projects/{id}. */
  version?: number | null;
  /** Новая версия проекта (каждый принятый PUT, перезагрузка после 409). */
  onVersion?: (version: number) => void;
  /** Принятая правка: новый текст файла, дерево проекта и анализ для остальных панелей. */
  onMutation?: (result: Schemas['MutationResult']) => void;
  /** 409: проект изменён, приложению стоит перезагрузить своё состояние. */
  onConflict?: (error: Schemas['Error']) => void;
}

type Listener = () => void;

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const asNumber = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/**
 * Синхронизация дерева блоков одного метода с бэкендом, без React.
 * Правка текста ноды → новое полное дерево (иммутабельная замена полей) → PUT blocks с текущей версией.
 * 200 → новая версия и дерево из ответа; 422 → нода красная с черновиком, дерево прежнее;
 * 409 → тост и перезагрузка GET blocks (и версии). В полёте не больше одного PUT.
 */
export class BlockSync {
  private state: BlockSyncState;
  private readonly listeners = new Set<Listener>();
  /** Растёт на каждую (пере)загрузку: ответы запросов старых поколений игнорируются. */
  private generation = 0;
  private inFlight: Promise<void> | null = null;
  private disposed = false;
  /** Самая новая версия, пришедшая извне (adoptVersion) и ещё не догнанная перезагрузкой дерева. */
  private externalVersion: number | null = null;

  constructor(private readonly options: BlockSyncOptions) {
    this.state = {
      status: 'loading',
      view: null,
      version: options.version ?? null,
      editing: null,
      invalid: null,
      error: null,
      conflict: null,
      stale: false,
    };
  }

  getState = (): BlockSyncState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * GET blocks (и версия проекта, если неизвестна или refreshVersion — после 409). Закрывает редактор.
   * Красная нода сбрасывается; с keepInvalid (перезагрузка из-за внешней версии) её черновик переносится
   * на новое дерево по id блока. Версия после загрузки — не ниже внешней, известной на старте запроса.
   */
  load(refreshVersion = false, keepInvalid = false): Promise<void> {
    const gen = ++this.generation;
    const before = { view: this.state.view, invalid: keepInvalid ? this.state.invalid : null };
    if (refreshVersion) this.externalVersion = null; // после 409 прав сервер
    const target = this.externalVersion;
    this.set({ status: 'loading', editing: null, invalid: before.invalid, error: null, stale: false });
    const { client, projectId, methodId } = this.options;
    const needVersion = refreshVersion || (this.state.version === null && target === null);
    const blocks = client.GET('/projects/{projectId}/methods/{methodId}/blocks', {
      params: { path: { projectId, methodId } },
    });
    const project = needVersion ? client.GET('/projects/{projectId}', { params: { path: { projectId } } }) : null;
    const p = Promise.all([blocks, project])
      .then(([b, pr]) => {
        if (this.isStale(gen)) return;
        if (!b.data) {
          this.set({ status: 'error', view: null, error: b.error?.message ?? `HTTP ${b.response.status}` });
          return;
        }
        if (pr?.data) this.takeVersion(pr.data.version, refreshVersion);
        // Дерево запрошено после того, как стала известна версия target, — оно не старше неё.
        if (target !== null) this.takeVersion(target, false);
        const invalid = before.invalid && before.view ? remapInvalid(before.invalid, before.view.root, b.data.root) : null;
        this.set({ status: 'ready', view: b.data, invalid });
        // Пока шёл запрос, версия могла вырасти ещё раз — догоняем.
        this.reconcile();
      })
      .catch((e: unknown) => {
        if (!this.isStale(gen)) this.set({ status: 'error', error: errorMessage(e) });
      });
    this.inFlight = p.finally(() => {
      if (this.generation === gen) this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Открыть инлайн-редактор ноды (двойной клик / кнопка). */
  startEdit(path: BlockPath): void {
    const block = this.state.view && blockAt(this.state.view.root, path);
    if (this.state.status !== 'ready' || !block || editableFields(block).length === 0) return;
    this.set({ editing: path, error: null });
  }

  /** Значения полей для редактора: черновик красной ноды или текст с сервера. */
  draftFor(path: BlockPath): Record<string, string> {
    const { invalid, view } = this.state;
    if (invalid && invalid.path === path) return { ...invalid.draft };
    const block = view && blockAt(view.root, path);
    return block ? draftOf(block) : {};
  }

  /**
   * Esc: закрыть редактор без отправки. У красной ноды — отменить и черновик (вернуть текст с сервера).
   * Если метод изменился извне (stale) — черновик отбрасывается и дерево перезагружается.
   */
  cancelEdit(): void {
    const { editing, invalid, status, stale } = this.state;
    if (editing === null || status === 'saving') return;
    const rest = invalid && invalid.path === editing ? null : invalid;
    if (stale) {
      this.set({ invalid: rest });
      void this.load(false, true);
      return;
    }
    this.set({ editing: null, invalid: rest });
  }

  /**
   * stale: применить черновик к новому дереву — перезагрузить метод, найти ноду по id и отправить правку.
   * Ноды больше нет (или kind другой) — правка не применяется, сообщение в error.
   */
  async rebase(path: BlockPath, draft: Record<string, string>): Promise<void> {
    const { stale, editing, view, status } = this.state;
    if (!stale || editing !== path || !view || status !== 'ready') return;
    const old = blockAt(view.root, path);
    await this.load(false, true);
    const fresh = this.state.view;
    const freshPath = old && fresh && this.state.status === 'ready' ? findPathById(fresh.root, old.id) : undefined;
    const block = freshPath && fresh ? blockAt(fresh.root, freshPath) : undefined;
    if (!old || !freshPath || !block || block.kind !== old.kind) {
      if (this.state.status === 'ready') this.set({ error: 'Нода исчезла после изменения метода — правка не применена' });
      return;
    }
    this.set({ editing: freshPath });
    await this.apply(freshPath, draft);
  }

  /** Отменить непринятую правку красной ноды. */
  discardInvalid(): void {
    if (this.state.invalid && this.state.status !== 'saving') this.set({ invalid: null });
  }

  /**
   * Enter / blur: применить правку ноды. Без изменений — просто закрыть редактор.
   * Черновик другой красной ноды в дерево не входит и отбрасывается.
   */
  apply(path: BlockPath, draft: Record<string, string>): Promise<void> {
    const { status, view, version, editing, invalid, stale } = this.state;
    // stale: дерево устарело — отправка затёрла бы правку из кода; только rebase или отмена.
    if (status !== 'ready' || !view || editing !== path || stale) return Promise.resolve();
    const block = blockAt(view.root, path);
    if (!block) return Promise.resolve();
    if (sameFields(mergeFields(block, draft), block.fields ?? {})) {
      this.set({ editing: null, invalid: invalid && invalid.path === path ? null : invalid });
      return Promise.resolve();
    }
    if (version === null) {
      this.set({ error: 'Версия проекта неизвестна — перезагрузите метод' });
      return Promise.resolve();
    }

    const root = withFields(view.root, path, draft);
    const gen = this.generation;
    this.set({ status: 'saving', error: null });
    const { client, projectId, methodId } = this.options;
    const p = client
      .PUT('/projects/{projectId}/methods/{methodId}/blocks', {
        params: { path: { projectId, methodId } },
        body: { version, root },
      })
      .then(({ data, error, response }): 'reload' | undefined => {
        if (this.isStale(gen)) return;
        if (data) {
          this.set({
            status: 'ready',
            view: data.method ?? { ...view, root },
            version: data.version,
            editing: null,
            invalid: null,
          });
          this.options.onVersion?.(data.version);
          this.options.onMutation?.(data);
          return;
        }
        if (response.status === 409) {
          const err: Schemas['Error'] = error ?? { code: 'VERSION_CONFLICT', message: 'HTTP 409' };
          const serverVersion = asNumber(err.details?.serverVersion);
          this.set({
            conflict: {
              clientVersion: asNumber(err.details?.clientVersion),
              serverVersion,
              message: err.message,
              seq: (this.state.conflict?.seq ?? 0) + 1,
            },
          });
          // Версия сервера из details — на случай, если GET /projects при перезагрузке не ответит.
          if (serverVersion !== undefined) this.takeVersion(serverVersion, true);
          this.options.onConflict?.(err);
          return 'reload';
        }
        if (response.status === 422 && error) {
          const errorPath = (error.blockId && findPathById(root, error.blockId)) || path;
          this.set({
            status: 'ready',
            editing: null,
            invalid: { path, draft: { ...draft }, errorPath, blockId: error.blockId, message: error.message },
          });
          return;
        }
        // Прочая ошибка: редактор остаётся открытым с введённым текстом, можно повторить.
        this.set({ status: 'ready', error: error?.message ?? `HTTP ${response.status}` });
      })
      .catch((e: unknown): undefined => {
        if (!this.isStale(gen)) this.set({ status: 'ready', error: errorMessage(e) });
        return undefined;
      });
    this.inFlight = p.then((outcome) => {
      if (this.isStale(gen)) return;
      this.inFlight = null;
      if (outcome === 'reload') return this.load(true);
      this.reconcile();
    });
    return this.inFlight;
  }

  /**
   * Версия проекта стала известна извне (правка кода в Monaco, фикс). Новее нашей — дерево метода могло
   * измениться: перезагружаем его (а не подменяем только версию — иначе следующий PUT со старым деревом
   * и свежей версией затёр бы чужую правку). Открыт редактор — дерево не трогаем, ставим stale.
   */
  adoptVersion(version: number): void {
    const known = Math.max(this.state.version ?? -Infinity, this.externalVersion ?? -Infinity);
    if (version <= known) return;
    this.externalVersion = version;
    this.reconcile();
  }

  /** Догнать внешнюю версию, когда нет запроса в полёте. */
  private reconcile(): void {
    const ext = this.externalVersion;
    const { status, version, editing, stale } = this.state;
    if (ext === null || (version !== null && ext <= version)) return;
    if (status === 'loading' || status === 'saving') return; // проверим после ответа
    if (status === 'error') return; // перезагрузит пользователь / смена метода
    if (editing !== null) {
      if (!stale) this.set({ stale: true });
      return;
    }
    void this.load(false, true);
  }

  dismissConflict(): void {
    if (this.state.conflict) this.set({ conflict: null });
  }

  /** Завершается, когда нет запроса в полёте (тесты). */
  async idle(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  /** Версия из GET /projects/{id}: после 409 — всегда (сервер прав), иначе — если новее. */
  private takeVersion(version: number, force: boolean): void {
    if (force || this.state.version === null || version > this.state.version) {
      this.set({ version });
      this.options.onVersion?.(version);
    }
  }

  private isStale(gen: number): boolean {
    return this.disposed || gen !== this.generation;
  }

  private set(patch: Partial<BlockSyncState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
}

/** Черновик красной ноды на новом дереве: пути ищутся по id блоков старого дерева. Нода пропала — null. */
function remapInvalid(invalid: InvalidEdit, oldRoot: Schemas['Block'], newRoot: Schemas['Block']): InvalidEdit | null {
  const move = (path: BlockPath): BlockPath | undefined => {
    const old = blockAt(oldRoot, path);
    const p = old && findPathById(newRoot, old.id);
    return p && blockAt(newRoot, p)?.kind === old.kind ? p : undefined;
  };
  const path = move(invalid.path);
  if (!path) return null;
  return { ...invalid, path, errorPath: move(invalid.errorPath) ?? path };
}
