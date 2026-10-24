import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api';
import type { PaletteCommand } from './entries';
import { fromTextInput, isPaletteHotkey } from './hotkey';

// Окно с cmdk грузится при первом открытии — основной чанк не растёт.
const PaletteDialog = lazy(() => import('./PaletteDialog'));

interface Props {
  client: ApiClient;
  /** Реестр команд (`app/commands.ts`). */
  commands: readonly PaletteCommand[];
  /** Запуск команды реестра по id (с проверкой isEnabled). */
  runCommand: (id: string, args?: Readonly<Record<string, string>>) => void;
}

/** Хоткей открытия палитры + само окно. Монтируется один раз на экране редактора. */
export function CommandPalette({ client, commands, runCommand }: Props) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const openRef = useRef(false);
  openRef.current = open;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteHotkey(e)) return;
      // Ctrl/Cmd+K в поле ввода или Monaco не трогаем: аккорды Monaco (Ctrl+K Ctrl+C), поля диалогов и нод.
      // Исключение — сама открытая палитра (её поле ввода): тем же сочетанием она закрывается.
      if (!e.shiftKey && !openRef.current && fromTextInput(e.target)) return;
      // Capture: браузер (Ctrl+K — адресная строка, Ctrl+Shift+P — приватное окно) не должен перехватить.
      e.preventDefault();
      e.stopPropagation();
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <PaletteDialog client={client} commands={commands} runCommand={runCommand} onClose={close} />
    </Suspense>
  );
}
