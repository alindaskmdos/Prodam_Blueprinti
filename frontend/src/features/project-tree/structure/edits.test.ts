import { describe, expect, it } from 'vitest';
import treeJson from '@contract/fixtures/tree.json';
import fileJson from '@contract/fixtures/file.order-service.json';
import type { Schemas } from '../../api';
import {
  appendClass,
  constructorTemplate,
  deleteField,
  deleteMethod,
  editClassHeader,
  editField,
  editMethodHeader,
  fieldTemplate,
  insertMember,
  methodTemplate,
  readClassHeader,
  readFieldDecl,
  readMethodHeader,
  type EditResult,
  type FieldNode,
} from './edits';
import { parseClassHeader, parseComponents, parseMethodHeader, type ClassHeaderEdit, type MethodHeaderEdit } from './headers';
import type { TextPos } from './javaText';

type ClassNode = Schemas['ClassNode'];
type MethodNode = Schemas['MethodNode'];

/** Позиция смещения (line/column с 1, column в UTF-16). */
function posAt(text: string, offset: number): TextPos {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - (before.lastIndexOf('\n') + 1) + 1 };
}

/** Позиция `n`-го вхождения `needle`. */
function pos(text: string, needle: string, n = 0): TextPos {
  let at = -1;
  for (let i = 0; i <= n; i++) {
    at = text.indexOf(needle, at + 1);
    if (at === -1) throw new Error(`нет «${needle}»`);
  }
  return posAt(text, at);
}

const lineOf = (text: string, needle: string) => pos(text, needle).line;

function method(text: string, name: string, start: string, end: string, extra: Partial<MethodNode> = {}): MethodNode {
  return {
    id: `p.A.${name}~0`,
    name,
    signature: name,
    issueCount: 0,
    headerStart: pos(text, start),
    headerEnd: pos(text, end),
    ...extra,
  };
}

function cls(text: string, name: string, start: string, extra: Partial<ClassNode> = {}): ClassNode {
  const s = pos(text, start);
  const openAt = text.indexOf('{', text.indexOf(start));
  return {
    name,
    kind: 'class',
    fields: [],
    constructors: [],
    methods: [],
    headerStart: s,
    headerEnd: posAt(text, openAt),
    ...extra,
  };
}

function need<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error('нет значения');
  return x;
}

function ok(r: EditResult): string {
  if (!r.ok) throw new Error(r.reason);
  return r.text;
}

const methodEdit = (m: Partial<MethodHeaderEdit> = {}): MethodHeaderEdit => ({
  modifiers: ['public'],
  typeParams: '',
  returnType: 'int',
  name: 'f',
  params: [],
  throws: [],
  ...m,
});

describe('заголовок метода', () => {
  it('однострочный метод: тело сохраняется байт в байт', () => {
    const text = 'class A {\n    int f() { return 1; }\n}\n';
    const m = method(text, 'f', 'int f', '{ return');
    const out = ok(editMethodHeader(text, m, methodEdit({ modifiers: ['private', 'static'], returnType: 'long', name: 'g' })));
    expect(out).toBe('class A {\n    private static long g() { return 1; }\n}\n');
  });

  it('«{» на следующей строке: перевод строки и отступ перед «{» сохраняются', () => {
    const text = 'class A {\n    public void run()\n    {\n    }\n}\n';
    const m = method(text, 'run', 'public void', '{\n    }');
    const out = ok(
      editMethodHeader(text, m, methodEdit({ returnType: 'void', name: 'run', params: [{ type: 'int', name: 'n' }] })),
    );
    expect(out).toBe('class A {\n    public void run(int n)\n    {\n    }\n}\n');
  });

  it('аннотации на отдельных строках переносятся как есть', () => {
    const text = 'class A {\n    @Override\n    @SuppressWarnings("x")\n    public String toString() {\n        return "";\n    }\n}\n';
    const m = method(text, 'toString', '@Override', '{\n        return');
    expect(readMethodHeader(text, m)).toMatchObject({ returnType: 'String', modifiers: ['public'], hasComments: false });
    const out = ok(editMethodHeader(text, m, methodEdit({ returnType: 'String', name: 'toString', modifiers: ['protected'] })));
    expect(out).toBe(
      'class A {\n    @Override\n    @SuppressWarnings("x")\n    protected String toString() {\n        return "";\n    }\n}\n',
    );
  });

  it('CRLF: остальной текст не меняется', () => {
    const text = 'class A {\r\n    int f(int a) {\r\n        return a;\r\n    }\r\n}\r\n';
    const m = method(text, 'f', 'int f', '{\r\n        return');
    const out = ok(editMethodHeader(text, m, methodEdit({ params: [{ type: 'int', name: 'a' }], throws: ['Exception'] })));
    expect(out).toBe('class A {\r\n    public int f(int a) throws Exception {\r\n        return a;\r\n    }\r\n}\r\n');
  });

  it('суррогатные пары и кириллица перед заголовком: column в UTF-16', () => {
    const text = 'class A { /* 😀 ж */ int f() { return 1; } }\n';
    const m = method(text, 'f', 'int f', '{ return');
    expect(m.headerStart?.column).toBe(22);
    const out = ok(editMethodHeader(text, m, methodEdit({ name: 'g', modifiers: [] })));
    expect(out).toBe('class A { /* 😀 ж */ int g() { return 1; } }\n');
  });

  it('interface/abstract-метод с «;»', () => {
    const text = 'interface I {\n    String name(int id) throws java.io.IOException;\n}\n';
    const m = method(text, 'name', 'String name', ';');
    expect(readMethodHeader(text, m)).toMatchObject({ params: [{ type: 'int', name: 'id' }], throws: ['java.io.IOException'] });
    const out = ok(
      editMethodHeader(text, m, methodEdit({ modifiers: [], returnType: 'String', name: 'title', params: [{ type: 'int', name: 'id' }] })),
    );
    expect(out).toBe('interface I {\n    String title(int id);\n}\n');
  });

  it('неизменённые параметры сохраняют final и аннотации, порядок — из формы', () => {
    const text = 'class A {\n    <T> void put(final @NonNull T key, int n) {}\n}\n';
    const m = method(text, 'put', '<T>', '{}');
    const out = ok(
      editMethodHeader(
        text,
        m,
        methodEdit({
          modifiers: [],
          typeParams: '<T>',
          returnType: 'void',
          name: 'put',
          params: [
            { type: 'long', name: 'n' },
            { type: 'T', name: 'key' },
          ],
        }),
      ),
    );
    expect(out).toBe('class A {\n    <T> void put(long n, final @NonNull T key) {}\n}\n');
  });

  it('конструктор: тип результата не появляется', () => {
    const text = 'class A {\n    A(int x) {}\n}\n';
    const m = method(text, 'A', 'A(int', '{}');
    expect(parseMethodHeader('A(int x)')).toMatchObject({ returnType: '', name: 'A' });
    const out = ok(editMethodHeader(text, m, methodEdit({ name: 'A', returnType: 'int', params: [] })));
    expect(out).toBe('class A {\n    public A() {}\n}\n');
  });

  it('устаревшие позиции (на headerEnd нет «{») — ошибка, текст не трогается', () => {
    const text = 'class A {\n    int f() { return 1; }\n}\n';
    const m = method(text, 'f', 'int f', 'return');
    expect(editMethodHeader(text, m, methodEdit()).ok).toBe(false);
    expect(editMethodHeader(text, { ...m, headerStart: undefined }, methodEdit()).ok).toBe(false);
  });

  it('комментарий в заголовке замечается', () => {
    expect(parseMethodHeader('public /* x */ int f()')?.hasComments).toBe(true);
  });
});

const classEdit = (e: Partial<ClassHeaderEdit> = {}): ClassHeaderEdit => ({
  modifiers: ['public'],
  keyword: 'class',
  name: 'OrderService',
  typeParams: '',
  extends: '',
  implements: [],
  ...e,
});

describe('заголовок класса', () => {
  it('не склеивает имя с «{» и сохраняет тело', () => {
    const text = 'package p;\n\npublic class OrderService {\n    int x;\n}\n';
    const c = cls(text, 'OrderService', 'public class');
    const out = ok(
      editClassHeader(text, c, classEdit({ modifiers: ['public', 'final'], extends: 'Base', implements: ['Runnable', 'Comparable<OrderService>'] })),
    );
    expect(out).toBe('package p;\n\npublic final class OrderService extends Base implements Runnable, Comparable<OrderService> {\n    int x;\n}\n');
  });

  it('record: компоненты сохраняются', () => {
    const text = '@Deprecated\npublic record Point<T>(int x, @Ann T y) implements Shape {}\n';
    const c = cls(text, 'Point', '@Deprecated', { kind: 'record' });
    const h = readClassHeader(text, c);
    expect(h).toMatchObject({ keyword: 'record', typeParams: '<T>', components: '(int x, @Ann T y)', implements: ['Shape'] });
    const out = ok(editClassHeader(text, c, classEdit({ keyword: 'record', name: 'Point', typeParams: '<T>', modifiers: [] })));
    expect(out).toBe('@Deprecated\nrecord Point<T>(int x, @Ann T y) {}\n');
  });

  it('record: компоненты из формы — неизменённые байт в байт, аннотации и varargs не теряются', () => {
    const text = 'record P(int x,   @Ann List<String> t, String... r) {}\n';
    const c = cls(text, 'P', 'record', { kind: 'record' });
    const edit = classEdit({
      keyword: 'record',
      name: 'P',
      modifiers: [],
      components: [
        { type: 'String...', name: 'r' },
        { type: '@Ann List<String>', name: 't' },
        { type: 'long', name: 'x' },
        { type: 'int', name: 'n' },
      ],
    });
    expect(ok(editClassHeader(text, c, edit))).toBe('record P(String... r, @Ann List<String> t, long x, int n) {}\n');
    expect(parseComponents('(int x, byte[] b)')?.map((p) => [p.type, p.name])).toEqual([
      ['int', 'x'],
      ['byte[]', 'b'],
    ]);
    expect(parseComponents('(int)')).toBeNull();
  });

  it('enum, sealed/permits и non-sealed', () => {
    expect(parseClassHeader('public enum Status implements HasCode')).toMatchObject({ keyword: 'enum', implements: ['HasCode'] });
    const sealed = parseClassHeader('public sealed interface Shape extends A, B permits Circle, Square');
    expect(sealed).toMatchObject({ modifiers: ['public', 'sealed'], extends: 'A, B', permits: 'Circle, Square' });
    expect(parseClassHeader('non-sealed class C extends Shape')).toMatchObject({ modifiers: ['non-sealed'] });
  });
});

describe('поле', () => {
  const text = 'class A {\n    // c\n    private final List<Order> orders = new ArrayList<>(); // tail\n    int a, b;\n}\n';
  const c = cls(text, 'A', 'class A');
  const orders: FieldNode = {
    name: 'orders',
    type: 'List<Order>',
    modifiers: ['private', 'final'],
    span: { file: 'A.java', startLine: 3, endLine: 3 },
  };
  const a: FieldNode = { name: 'a', type: 'int', span: { file: 'A.java', startLine: 4, endLine: 4 } };
  const b: FieldNode = { name: 'b', type: 'int', span: { file: 'A.java', startLine: 4, endLine: 4 } };
  const withFields = { ...c, fields: [orders, a, b] };

  it('меняются тип/имя/модификаторы, инициализатор и комментарий в конце — нет', () => {
    const out = ok(editField(text, withFields, orders, { modifiers: ['protected'], type: 'Collection<Order>', name: 'all' }));
    expect(out).toBe(
      'class A {\n    // c\n    protected Collection<Order> all = new ArrayList<>(); // tail\n    int a, b;\n}\n',
    );
  });

  it('запятые в инициализаторе и аннотация на отдельной строке', () => {
    const src = 'class M {\n    @Inject\n    Map<String, Integer> m = new HashMap<String, Integer>(Map.of("a", 1));\n}\n';
    const m: FieldNode = { name: 'm', type: 'Map<String, Integer>', span: { file: 'M', startLine: 2, endLine: 3 } };
    const owner = { ...cls(src, 'M', 'class M'), fields: [m] };
    expect(ok(editField(src, owner, m, { modifiers: ['private'], type: 'Map<String, Integer>', name: 'counts' }))).toBe(
      'class M {\n    @Inject\n    private Map<String, Integer> counts = new HashMap<String, Integer>(Map.of("a", 1));\n}\n',
    );
  });

  it('общий span (`int a, b;`) — только чтение', () => {
    expect(typeof readFieldDecl(text, withFields, a)).toBe('string');
    expect(editField(text, withFields, a, { modifiers: [], type: 'int', name: 'z' }).ok).toBe(false);
  });

  it('span не про это поле (дерево устарело) — только чтение', () => {
    expect(typeof readFieldDecl(text, withFields, { ...orders, name: 'other' })).toBe('string');
  });

  it('удаление вырезает строки поля', () => {
    expect(ok(deleteField(text, withFields, orders))).toBe('class A {\n    // c\n    int a, b;\n}\n');
  });
});

describe('удаление метода', () => {
  it('с аннотацией и javadoc, пустая строка схлопывается', () => {
    const text = 'class A {\n    int x;\n\n    /** doc */\n    @Deprecated\n    void f() {\n        g();\n    }\n\n    void h() {}\n}\n';
    const m = method(text, 'f', '@Deprecated', '{\n        g');
    expect(ok(deleteMethod(text, m))).toBe('class A {\n    int x;\n\n    void h() {}\n}\n');
  });

  it('метод на одной строке с другим кодом — отказ', () => {
    const text = 'class A { int f() { return 1; } }\n';
    expect(deleteMethod(text, method(text, 'f', 'int f', '{ return')).ok).toBe(false);
  });
});

describe('вставка членов', () => {
  it('метод перед «}» с отступом соседей и return по типу', () => {
    const text = 'class A {\n  int x;\n\n  void f() {}\n}\n';
    const c = cls(text, 'A', 'class A', {
      fields: [{ name: 'x', type: 'int', span: { file: 'A', startLine: 2, endLine: 2 } }],
      methods: [{ ...method(text, 'f', 'void f', '{}'), span: { file: 'A', startLine: 4, endLine: 4 } }],
    });
    const out = ok(insertMember(text, c, 'method', methodTemplate('class', 'boolean', 'ok')));
    expect(out).toBe('class A {\n  int x;\n\n  void f() {}\n\n  public boolean ok() {\n      return false;\n  }\n}\n');
  });

  it('поле — после последнего поля; CRLF сохраняется', () => {
    const text = 'class A {\r\n    int x;\r\n\r\n    void f() {}\r\n}\r\n';
    const c = cls(text, 'A', 'class A', { fields: [{ name: 'x', type: 'int', span: { file: 'A', startLine: 2, endLine: 2 } }] });
    const out = ok(insertMember(text, c, 'field', fieldTemplate('class', 'String', 'name')));
    expect(out).toBe('class A {\r\n    int x;\r\n    private String name;\r\n\r\n    void f() {}\r\n}\r\n');
  });

  it('пустой однострочный класс', () => {
    const text = 'class A {}\n';
    const out = ok(insertMember(text, cls(text, 'A', 'class A'), 'constructor', need(constructorTemplate('class', 'A'))));
    expect(out).toBe('class A {\n    public A() {\n    }\n}\n');
  });

  it('enum без «;» после констант получает «;»', () => {
    const text = 'enum E {\n    A, B // last\n}\n';
    const c = cls(text, 'E', 'enum E', { kind: 'enum' });
    const out = ok(insertMember(text, c, 'method', methodTemplate('enum', 'void', 'run')));
    expect(out).toBe('enum E {\n    A, B; // last\n\n    public void run() {\n    }\n}\n');
  });

  it('interface: метод без тела, поле с инициализатором; record и interface без конструктора', () => {
    expect(methodTemplate('interface', 'int', 'size')('    ')).toEqual(['int size();']);
    expect(fieldTemplate('interface', 'int', 'MAX')('    ')).toEqual(['int MAX = 0;']);
    expect(fieldTemplate('record', 'int', 'cache')('    ')).toEqual(['private static int cache;']);
    expect(constructorTemplate('record', 'R')).toBeNull();
    expect(need(constructorTemplate('enum', 'Outer$E'))('  ')).toEqual(['private E() {', '}']);
  });

  it('новый класс дописывается в конец файла, текст файла не меняется', () => {
    expect(appendClass('package p;\n\npublic class A {}\n', 'class', 'B')).toBe('package p;\n\npublic class A {}\n\nclass B {\n}\n');
    expect(appendClass('class A {}', 'record', 'R')).toBe('class A {}\n\nrecord R() {\n}\n');
  });
});

describe('фикстура tree.json и file.order-service.json', () => {
  const tree = treeJson as unknown as Schemas['ProjectTree'];
  const file = fileJson as Schemas['FileText'];
  const c = need(tree.packages[0]?.files[0]?.classes[0]);

  it('заголовки OrderService и merge читаются по headerStart/headerEnd', () => {
    expect(readClassHeader(file.text, c)).toMatchObject({ keyword: 'class', name: 'OrderService', modifiers: ['public'] });
    expect(readMethodHeader(file.text, need(c.methods[0]))).toMatchObject({ name: 'merge', returnType: 'int' });
    expect(readFieldDecl(file.text, c, need(c.fields[0]))).toMatchObject({ name: 'orders', type: 'List<Order>' });
    const renamed = ok(editClassHeader(file.text, c, classEdit({ name: 'Orders' })));
    expect(renamed.split('\n')[lineOf(file.text, 'public class') - 1]).toBe('public class Orders {');
  });
});
