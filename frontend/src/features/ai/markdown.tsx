import { Fragment, type ReactNode } from 'react';
import styles from './Ai.module.css';

/** Мини-markdown ответа ИИ: абзацы, **жирный** и `код`. Остальное — как есть (ponytail: списки/заголовки не разбираем). */
export function renderMarkdown(text: string): ReactNode {
  return text.split(/\n{2,}/).map((para, i) => (
    <p key={i} className={styles.para}>
      {para.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, j) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
          <strong key={j}>{part.slice(2, -2)}</strong>
        ) : part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
          <code key={j}>{part.slice(1, -1)}</code>
        ) : (
          <Fragment key={j}>{part}</Fragment>
        ),
      )}
    </p>
  ));
}
