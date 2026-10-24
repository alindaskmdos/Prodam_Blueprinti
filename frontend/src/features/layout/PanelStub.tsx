import styles from './layout.module.css';

/** Заглушка содержимого вкладки/слота до реализации фичи. */
export function PanelStub({ text }: { text: string }) {
  return (
    <div className={styles.stub} data-testid="panel-stub">
      {text}
    </div>
  );
}
