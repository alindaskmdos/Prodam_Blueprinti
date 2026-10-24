/** Ctrl/Cmd+K и Ctrl/Cmd+Shift+P. */
export function isPaletteHotkey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const key = e.key.toLowerCase();
  return (key === 'k' && !e.shiftKey) || (key === 'p' && e.shiftKey);
}

/** Фокус в поле ввода (input, textarea — в т.ч. скрытая textarea Monaco, contenteditable). */
export function fromTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}
