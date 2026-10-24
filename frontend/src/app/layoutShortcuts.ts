import { useEffect } from 'react';
import { fromTextInput } from '../features/command-palette';
import { runCommand } from './commands';

/** Горячие клавиши панелей: Ctrl/Cmd+B — проект, Ctrl+J — нижняя, Ctrl+Alt+B — анализ, Ctrl+\ — «Только схема». */
const SHORTCUTS: { code: string; alt: boolean; command: string }[] = [
  { code: 'KeyB', alt: false, command: 'layout.toggleLeft' },
  { code: 'KeyB', alt: true, command: 'layout.toggleRight' },
  { code: 'KeyJ', alt: false, command: 'layout.toggleBottom' },
  { code: 'Backslash', alt: false, command: 'layout.canvasOnly' },
];

/** Слушает сочетания по `event.code` (работают и в русской раскладке) и запускает команды layout.*. */
export function useLayoutShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // В полях ввода (Monaco, ноды, формы) сочетания не трогаем.
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || fromTextInput(e.target)) return;
      const hit = SHORTCUTS.find((s) => s.code === e.code && s.alt === e.altKey);
      if (!hit) return;
      e.preventDefault();
      runCommand(hit.command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
