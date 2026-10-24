import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { CODE_FONT, GRAPHITE_THEME, setupMonaco } from './monacoSetup';
import type { ParseError } from './fileSync';
import type { RevealLines } from './reveal';

const monaco = setupMonaco();
const MARKER_OWNER = 'jb-parse';
/** Класс строк подсветки (FE-05), стиль — CodeEditor.module.css (:global). */
export const HIGHLIGHT_CLASS = 'jb-code-highlight';
export const HIGHLIGHT_GLYPH_CLASS = 'jb-code-highlight-glyph';

type CodeEditorInstance = Parameters<OnMount>[0];

export interface MonacoViewProps {
  /** Текст из GET files; подставляется в редактор при смене loadSeq. */
  text: string;
  loadSeq: number;
  parseError: ParseError | null;
  onChange: (text: string) => void;
  /** Только для чтения (открыта плашка «Ваши правки не отправлены»). */
  readOnly?: boolean;
  /** Подсветка диапазона строк (клик по ноде, выбор проблемы); null — снять. */
  reveal?: RevealLines | null;
  /** Курсор поставлен пользователем (мышь/клавиатура) на строку — не при программной подмене текста. */
  onCursorLine?: (line: number) => void;
}

/** Monaco без логики синхронизации: показывает текст, отдаёт правки, рисует маркер ошибки. */
export default function MonacoView({
  text,
  loadSeq,
  parseError,
  onChange,
  readOnly = false,
  reveal = null,
  onCursorLine,
}: MonacoViewProps) {
  const editorRef = useRef<CodeEditorInstance | null>(null);
  const suppress = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const textRef = useRef(text);
  textRef.current = text;
  const onCursorRef = useRef(onCursorLine);
  onCursorRef.current = onCursorLine;
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const decorations = useRef<ReturnType<CodeEditorInstance['createDecorationsCollection']> | null>(null);

  /** Подсветка строк reveal; scroll — прокрутить (на новое событие, не на перезагрузку текста). */
  const applyReveal = (scroll: boolean) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    decorations.current ??= editor.createDecorationsCollection();
    const r = revealRef.current;
    if (!r) {
      decorations.current.clear();
      return;
    }
    const last = model.getLineCount();
    const start = Math.min(Math.max(r.startLine, 1), last);
    const end = Math.min(Math.max(r.endLine, start), last);
    decorations.current.set([
      {
        range: new monaco.Range(start, 1, end, model.getLineMaxColumn(end)),
        options: { isWholeLine: true, className: HIGHLIGHT_CLASS, linesDecorationsClassName: HIGHLIGHT_GLYPH_CLASS },
      },
    ]);
    // Только прокрутка: курсор и выделение не трогаются — иначе событие курсора вернулось бы на холст.
    if (scroll) editor.revealLinesInCenterIfOutsideViewport(start, end, monaco.editor.ScrollType.Smooth);
  };

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.onDidChangeModelContent(() => {
      if (!suppress.current) onChangeRef.current(editor.getValue());
    });
    editor.onDidChangeCursorPosition((e) => {
      // Программные изменения (setValue при перезагрузке, API) — не действие пользователя.
      if (suppress.current || e.source === 'api' || e.source === 'model') return;
      onCursorRef.current?.(e.position.lineNumber);
    });
    applyReveal(true);
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
    // Новый текст — подсветка заново по тем же строкам, без прокрутки.
    applyReveal(false);
  }, [loadSeq]);

  useEffect(() => {
    applyReveal(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyReveal читает только ref
  }, [reveal?.seq, reveal?.startLine, reveal?.endLine, reveal === null]);

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
        readOnly,
      }}
    />
  );
}
