import { isKnownKind, type Block } from './kinds';

/** Текст неизвестного kind: fields.text, иначе JSON полей — код не теряется. */
function fallbackText(block: Block): string {
  const fields = block.fields ?? {};
  return typeof fields.text === 'string' ? fields.text : JSON.stringify(fields);
}

/** Текст ноды (Java-подобный), собранный из fields по kind. Отсутствующее поле — пустая строка. Всегда строка. */
export function blockText(block: Block): string {
  if (!isKnownKind(block.kind)) return fallbackText(block);
  return String(knownText(block));
}

function knownText(block: Block): string {
  const f = (key: string): string => block.fields?.[key] ?? '';
  const has = (key: string): boolean => block.fields?.[key] !== undefined && block.fields[key] !== '';

  switch (block.kind) {
    case 'method':
      return f('signature');
    case 'var':
      return `${f('type')} ${f('name')}${has('init') ? ` = ${f('init')}` : ''}`;
    case 'assign':
      return `${f('target')} ${f('op') || '='} ${f('value')}`;
    case 'expr':
    case 'comment':
    case 'raw':
      return f('text');
    case 'if':
      return f('cond');
    case 'while':
      return `while (${f('cond')})`;
    case 'dowhile':
      return `do … while (${f('cond')})`;
    case 'for':
      return `for (${f('init')}; ${f('cond')}; ${f('update')})`;
    case 'foreach':
      return `for (${f('type')} ${f('var')} : ${f('iterable')})`;
    case 'switch':
      return `switch (${f('selector')})`;
    case 'case': {
      const label = f('label');
      const arrow = f('arrow') === 'true';
      if (label === 'default') return arrow ? 'default ->' : 'default:';
      return `case ${label}${arrow ? ' ->' : ':'}`;
    }
    case 'try':
      return has('resources') ? `try (${f('resources')})` : 'try';
    case 'catch':
      return `catch (${f('type')} ${f('var')})`;
    case 'return':
      return has('value') ? `return ${f('value')}` : 'return';
    case 'throw':
      return `throw ${f('value')}`;
    case 'break':
    case 'continue':
      return has('label') ? `${block.kind} ${f('label')}` : block.kind;
    default:
      return fallbackText(block);
  }
}
