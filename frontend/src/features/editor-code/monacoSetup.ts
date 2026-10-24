// Локальная сборка Monaco (без CDN): только ядро редактора + подсветка Java.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { loader } from '@monaco-editor/react';

export const GRAPHITE_THEME = 'jb-graphite';

/** Шрифт кода — JetBrains Mono (docs/design/README.md). */
export const CODE_FONT = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace";

let configured = false;

/** Значение CSS-токена из tokens.css; Monaco принимает только hex, не var(). */
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;
}

function hex(color: string): string {
  return color.replace('#', '');
}

export function setupMonaco(): typeof monaco {
  if (configured) return monaco;
  configured = true;

  self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
  loader.config({ monaco });

  const panel = token('--jb-panel', '#11151b');
  const raised = token('--jb-raised', '#161b23');
  const selected = token('--jb-selected', '#1b2532');
  const border = token('--jb-border', '#1f2630');
  const text = token('--jb-text', '#e6eaf0');
  const secondary = token('--jb-text-secondary', '#9aa4b2');
  const accent = token('--jb-accent', '#5b9bff');
  const high = token('--jb-severity-high', '#f87171');
  const medium = token('--jb-severity-medium', '#fbbf24');
  const muted = token('--jb-node-raw', '#5e6878');

  // Цвета подсветки — из макета «Код Java» (docs/design/screens/Editor.dc.html, классы .k .t .f .c .s).
  monaco.editor.defineTheme(GRAPHITE_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'D4DAE3' },
      { token: 'keyword', foreground: 'C792EA' },
      { token: 'type', foreground: '7FDBCA' },
      { token: 'type.identifier', foreground: '7FDBCA' },
      { token: 'annotation', foreground: '82AAFF' },
      { token: 'comment', foreground: '8B95A4', fontStyle: 'italic' },
      { token: 'string', foreground: 'ECC48D' },
      { token: 'number', foreground: hex(medium) },
      { token: 'delimiter', foreground: hex(secondary) },
    ],
    colors: {
      'editor.background': panel,
      'editor.foreground': '#D4DAE3',
      'editorLineNumber.foreground': muted,
      'editorLineNumber.activeForeground': secondary,
      'editor.lineHighlightBackground': raised,
      'editor.lineHighlightBorder': raised,
      'editor.selectionBackground': `${accent}40`,
      'editor.inactiveSelectionBackground': selected,
      'editorCursor.foreground': accent,
      'editorIndentGuide.background1': border,
      'editorWidget.background': raised,
      'editorWidget.border': border,
      'editorError.foreground': high,
      'editorWarning.foreground': medium,
      'scrollbarSlider.background': `${muted}55`,
      'scrollbarSlider.hoverBackground': `${muted}88`,
      'focusBorder': accent,
      'foreground': text,
    },
  });

  return monaco;
}
