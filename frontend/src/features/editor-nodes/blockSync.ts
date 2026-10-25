import { getMethodBlocks, type ApiClient, type Schemas } from '../api';
import { blockAt, draftOf, editableFields, findPathById, mergeFields, sameFields, withFields, type BlockPath } from './blockEdit';
import { blockText } from './blockText';
import {
  editsOnInsert,
  insertBlock,
  moveBlock,
  parentOf,
  removeBlock,
  sameShape,
  templateFor,
  type InsertPoint,
  type MoveSkip,
} from './blockTree';

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

/**
 * Вставленный блок, ещё не принятый сервером (FE-08): локальное дерево с новой нодой.
 * Пока он есть, схема показывает это дерево; Enter в редакторе новой ноды отправляет его целиком,
 * Esc / «Отменить правку» — убирает вставку. 422 — нода красная, введённый текст остаётся в дереве.
 */
export interface PendingInsert {
  root: Schemas['Block'];
  /** Путь новой ноды в root. */
  path: BlockPath;
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
  /** Неотправленная (или отклонённая 422) вставка блока. */
  pending: PendingInsert | null;
  /**
   * Вставку не удалось перенести на новое дерево (родителя больше нет): введённый текст, чтобы его не потерять
   * (показывается с кнопкой «Скопировать»).
   */
  lostInsert: { text: string } | null;
}

/** Вставка, переносимая на перезагруженное дерево: родитель по id, слот, индекс и сам блок с текстом. */
interface CarriedInsert {
  parentId: string;
  parentIsRoot: boolean;
  slot: string;
  index: number;
  block: Schemas['Block'];
  message?: string;
}

/** Дерево, которое показывается и правится: с неотправленной вставкой, иначе с сервера. */
export function currentRoot(state: Pick<BlockSyncState, 'view' | 'pending'>): Schemas['Block'] | null {
  return state.pending?.root ?? state.view?.root ?? null;
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
      pending: null,
      lostInsert: null,
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
    // Неотправленная вставка переносится на новое дерево по id родителя (текст не теряется).
    const carry = this.carryInsert();
    const before = { view: this.state.view, invalid: keepInvalid && !carry ? this.state.invalid : null };
    if (refreshVersion) this.externalVersion = null; // после 409 прав сервер
    const target = this.externalVersion;
    this.set({ status: 'loading', editing: null, invalid: before.invalid, error: null, stale: false, pending: null });
    const { client, projectId, methodId } = this.options;
    const needVersion = refreshVersion || (this.state.version === null && target === null);
    // Общий запрос с прокруткой кода к методу (FE-35) и предзагрузкой из UML (FE-16) — один GET на выбор метода.
    const blocks = getMethodBlocks(client, projectId, methodId, target ?? this.state.version);
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
        if (carry) this.restoreInsert(carry, b.data.root);
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
    const root = currentRoot(this.state);
    const block = root && blockAt(root, path);
    if (this.state.status !== 'ready' || !block || editableFields(block).length === 0) return;
    this.set({ editing: path, error: null });
  }

  /** Значения полей для редактора: черновик красной ноды или текст с сервера. */
  draftFor(path: BlockPath): Record<string, string> {
    const { invalid } = this.state;
    if (invalid && invalid.path === path) return { ...invalid.draft };
    const root = currentRoot(this.state);
    const block = root && blockAt(root, path);
    return block ? draftOf(block) : {};
  }

  /**
   * Esc: закрыть редактор без отправки. У красной ноды — отменить и черновик (вернуть текст с сервера).
   * Если метод изменился извне (stale) — черновик отбрасывается и дерево перезагружается.
   */
  cancelEdit(): void {
    const { editing, invalid, status, stale, pending } = this.state;
    if (editing === null || status === 'saving') return;
    if (pending && pending.path === editing) {
      // Esc в редакторе новой ноды — вставка отменяется.
      this.set({ editing: null, pending: null, invalid: null });
      if (stale) void this.load(false, true);
      return;
    }
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
    const { pending } = this.state;
    if (pending) {
      // Черновик новой ноды — в дерево вставки, вставка переносится на новое дерево и отправляется.
      this.set({ pending: { ...pending, root: withFields(pending.root, pending.path, draft) } });
      await this.load(false, true);
      const moved = this.state.pending;
      if (this.state.status !== 'ready' || !moved) return;
      this.set({ editing: moved.path });
      await this.apply(moved.path, draft);
      return;
    }
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

  /** Закрыть сообщение о непереносимой вставке. */
  dismissLostInsert(): void {
    if (this.state.lostInsert) this.set({ lostInsert: null });
  }

  /** Неотправленная вставка для переноса на перезагруженное дерево: родитель по id, слот, индекс. */
  private carryInsert(): CarriedInsert | null {
    const { pending, invalid } = this.state;
    if (!pending) return null;
    const at = parentOf(pending.path);
    const parent = at && blockAt(pending.root, at.parent);
    const block = blockAt(pending.root, pending.path);
    if (!at || !parent || !block) return null;
    // Текст красной новой ноды (422) — в invalid.draft.
    const own = invalid && invalid.path === pending.path ? invalid : null;
    return {
      parentId: parent.id,
      parentIsRoot: at.parent === 'root',
      slot: at.slot,
      index: at.index,
      block: own ? { ...block, fields: mergeFields(block, own.draft) } : block,
      ...(own ? { message: own.message } : {}),
    };
  }

  /** Вставить перенесённый блок в новое дерево; родителя нет — сообщение с текстом блока. */
  private restoreInsert(carry: CarriedInsert, root: Schemas['Block']): void {
    const parentPath = carry.parentIsRoot ? 'root' : findPathById(root, carry.parentId);
    const parent = parentPath ? blockAt(root, parentPath) : undefined;
    const len = parent?.slots?.[carry.slot]?.length ?? 0;
    const res = parentPath ? insertBlock(root, { parent: parentPath, slot: carry.slot, index: Math.min(carry.index, len) }, carry.block) : null;
    if (!res) {
      this.set({ lostInsert: { text: blockText(carry.block) } });
      return;
    }
    this.set({
      pending: { root: res.root, path: res.path },
      lostInsert: null,
      invalid: {
        path: res.path,
        draft: draftOf(carry.block),
        errorPath: res.path,
        message: carry.message ?? 'Метод изменился — новый блок ещё не сохранён. Откройте и примените ещё раз.',
      },
    });
  }

  /** Отменить непринятую правку красной ноды. */
  discardInvalid(): void {
    if ((this.state.invalid || this.state.pending) && this.state.status !== 'saving') this.set({ invalid: null, pending: null });
  }

  /**
   * Enter / blur: применить правку ноды. Без изменений — просто закрыть редактор.
   * Черновик другой красной ноды в дерево не входит и отбрасывается.
   */
  apply(path: BlockPath, draft: Record<string, string>): Promise<void> {
    const { status, view, version, editing, invalid, stale, pending } = this.state;
    // stale: дерево устарело — отправка затёрла бы правку из кода; только rebase или отмена.
    if (status !== 'ready' || !view || editing !== path || stale) return Promise.resolve();
    const base = pending?.root ?? view.root;
    const block = blockAt(base, path);
    if (!block) return Promise.resolve();
    // Без изменений — закрыть редактор. Неотправленная вставка — сама по себе изменение.
    if (!pending && sameFields(mergeFields(block, draft), block.fields ?? {})) {
      this.set({ editing: null, invalid: invalid && invalid.path === path ? null : invalid });
      return Promise.resolve();
    }
    if (version === null) {
      this.set({ error: 'Состояние проекта неизвестно — перезагрузите метод' });
      return Promise.resolve();
    }

    const root = withFields(base, path, draft);
    return this.send(version, view, root, (error) => {
      const errorPath = (error.blockId && findPathById(root, error.blockId)) || path;
      this.set({
        status: 'ready',
        editing: null,
        // Введённый текст остаётся в дереве вставки — правка другой ноды его не потеряет.
        ...(pending ? { pending: { root, path: pending.path } } : {}),
        invalid: { path, draft: { ...draft }, errorPath, blockId: error.blockId, message: error.message },
      });
    });
  }

  /**
   * «+» на стрелке: новый блок kind в место point. Есть что вводить — нода появляется локально с открытым
   * редактором (Enter — PUT полного дерева, Esc — вставка отменяется); иначе (break, continue, try) — сразу PUT.
   * Сначала ждёт запрос в полёте (blur редактора перед кликом). false — вставка сейчас невозможна.
   */
  async insert(point: InsertPoint, kind: Schemas['BlockKind']): Promise<boolean> {
    const asked = this.state.view?.root;
    await this.idle();
    const { view } = this.state;
    if (!this.structureOpen() || !view || !asked || !sameShape(asked, view.root)) return false;
    const owner = blockAt(view.root, point.parent);
    if (!owner) return false;
    const block = templateFor(owner, point.slot, kind);
    const res = insertBlock(view.root, point, block);
    if (!res) return false;
    // Черновик другой красной ноды в дерево не входит и отбрасывается (как при правке текста).
    this.set({ pending: { root: res.root, path: res.path }, editing: res.path, invalid: null, error: null });
    if (!editsOnInsert(block)) await this.apply(res.path, draftOf(block));
    return true;
  }

  /** Удалить блок (с содержимым) и отправить полное дерево. 422 — откат: дерево прежнее, сообщение в error. */
  async remove(path: BlockPath): Promise<void> {
    const asked = this.state.view?.root;
    await this.idle();
    const { view } = this.state;
    // Пока ждали, структура поменялась — путь указывает на другой блок: ничего не делаем.
    if (!this.structureOpen() || !view || !asked || !sameShape(asked, view.root)) return;
    const root = removeBlock(view.root, path);
    if (root !== view.root) await this.sendStructure(root);
  }

  /** Вверх (-1) / вниз (+1) внутри того же слота (skip — скрытые на схеме соседи). На границе — ничего. */
  async move(path: BlockPath, delta: -1 | 1, skip?: MoveSkip): Promise<void> {
    const asked = this.state.view?.root;
    await this.idle();
    const { view } = this.state;
    if (!this.structureOpen() || !view || !asked || !sameShape(asked, view.root)) return;
    const { root } = moveBlock(view.root, path, delta, skip);
    if (root !== view.root) await this.sendStructure(root);
  }

  /** Можно ли сейчас менять структуру: дерево загружено, нет неотправленной вставки, открытого редактора и stale. */
  structureOpen(): boolean {
    const { status, view, pending, stale, editing, version } = this.state;
    return status === 'ready' && view !== null && pending === null && !stale && editing === null && version !== null;
  }

  private sendStructure(root: Schemas['Block']): Promise<void> {
    const { view, version } = this.state;
    if (!view || version === null) return Promise.resolve();
    return this.send(version, view, root, (error) => {
      // Структура не применилась: на экране дерево с сервера — правка откатилась.
      this.set({ status: 'ready', error: `операция не применена: ${error.message}` });
    });
  }

  /**
   * PUT blocks {version, root} — общий путь правки текста и структуры. 200 → дерево и версия из ответа;
   * 409 → тост и перезагрузка; 422 → onInvalid; прочее → error (редактор, если открыт, остаётся).
   */
  private send(
    version: number,
    view: Schemas['MethodView'],
    root: Schemas['Block'],
    onInvalid: (error: Schemas['Error']) => void,
  ): Promise<void> {
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
            pending: null,
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
          onInvalid(error);
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
