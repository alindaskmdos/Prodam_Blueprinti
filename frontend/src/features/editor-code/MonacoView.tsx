import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { CODE_FONT, GRAPHITE_THEME, setupMonaco } from './monacoSetup';
import type { ParseError } from './fileSync';

const monaco = setupMonaco();
const MARKER_OWNER = 'jb-parse';

type CodeEditorInstance = Parameters<OnMount>[0];

export interface MonacoViewProps {
  /** Текст из GET files; подставляется в редактор при смене loadSeq. */
  text: string;
  loadSeq: number;
  parseError: ParseError | null;
  onChange: (text: string) => void;
}

/** Monaco без логики синхронизации: показывает текст, отдаёт правки, рисует маркер ошибки. */
export default function MonacoView({ text, loadSeq, parseError, onChange }: MonacoViewProps) {
  const editorRef = useRef<CodeEditorInstance | null>(null);
  const suppress = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const textRef = useRef(text);
  textRef.current = text;

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.onDidChangeModelContent(() => {
      if (!suppress.current) onChangeRef.current(editor.getValue());
    });
  };

  // Перезагрузка (после 409 или смены файла) — подменить содержимое без события правки.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === textRef.current) return;
    suppress.current = true;
    try {
      editor.setValue(textRef.current);
    } finally {
      suppress.current = false;
    }
  }, [loadSeq]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    if (!parseError?.line) {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
      return;
    }
    const line = Math.min(Math.max(parseError.line, 1), model.getLineCount());
    monaco.editor.setModelMarkers(model, MARKER_OWNER, [
      {
        severity: monaco.MarkerSeverity.Error,
        message: parseError.message,
        startLineNumber: line,
        startColumn: model.getLineFirstNonWhitespaceColumn(line) || 1,
        endLineNumber: line,
        endColumn: model.getLineMaxColumn(line),
      },
    ]);
  }, [parseError]);

  return (
    <Editor
      language="java"
      theme={GRAPHITE_THEME}
      defaultValue={text}
      onMount={handleMount}
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
