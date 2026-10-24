import Editor from '@monaco-editor/react';
import { CODE_FONT, GRAPHITE_THEME, setupMonaco } from '../editor-code/monaco';

// Та же локальная сборка Monaco и тема jb-graphite, что у «Код Java» (editor-code).
setupMonaco();

export interface JUnitSourceEditorProps {
  /** Начальный текст; редактор пересоздаётся ключом при смене теста или перезагрузке. */
  value: string;
  onChange: (text: string) => void;
}

/** Monaco для текста tests/*.java. Грузится лениво отдельным чанком. */
export default function JUnitSourceEditor({ value, onChange }: JUnitSourceEditorProps) {
  return (
    <Editor
      language="java"
      theme={GRAPHITE_THEME}
      defaultValue={value}
      onChange={(v) => onChange(v ?? '')}
      loading={null}
      options={{
        fontFamily: CODE_FONT,
        fontSize: 13,
        lineHeight: 20,
        fontLigatures: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        renderLineHighlight: 'line',
        padding: { top: 8, bottom: 8 },
      }}
    />
  );
}
