import { RunOutput, useTestsStore } from '../features/tests-panel';
import { PanelStub } from '../features/layout';

/** Вкладка «Консоль»: вывод последнего запуска программы (stdout/stderr) либо подсказка, как его получить. */
export function ConsolePanel() {
  const run = useTestsStore((s) => s.run);
  if (!run) return <PanelStub text="Нажмите ▶ Запуск — здесь появится вывод программы" />;
  return <RunOutput run={run} />;
}
