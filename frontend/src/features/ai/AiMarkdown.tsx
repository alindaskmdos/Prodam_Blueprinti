import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Ai.module.css';

// Ссылки ответа ИИ — во внешней вкладке, без доступа к window.opener.
const components: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

/**
 * Ответ ИИ в markdown (GFM: заголовки, списки, код, таблицы, цитаты). Сырой HTML не исполняется:
 * без rehype-raw react-markdown его не выводит. Отдельный модуль — грузится лениво (свой чанк).
 */
export default function AiMarkdown({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
