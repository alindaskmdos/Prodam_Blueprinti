import { highlightJava } from './highlightJava';
import styles from './MethodCanvas.module.css';

/** Текст с лёгкой подсветкой Java (просмотр в ноде и слой подсветки инлайн-редактора). */
export function JavaText({ text }: { text: string }) {
  return (
    <>
      {highlightJava(text).map((t, i) =>
        t.type === 'plain' ? (
          t.text
        ) : (
          <span key={i} className={styles[`tok_${t.type}`]}>
            {t.text}
          </span>
        ),
      )}
    </>
  );
}
