import { useMemo, type ReactNode } from 'react';
import { api, type ApiClient, type Schemas } from '../api';
import { useAiFeature } from '../ai';
import { shortMethodName } from '../layout';
import { isFixRunning, useFixStore } from '../fix';
import { sandboxDisabledReason, useSandboxStore } from '../sandbox';
import { runCommand } from '../../app/commands';
import { useAppStore } from '../../app/store';
import { useAnalysis } from './analysisStore';
import { groupByScope, issuesSummary, splitIssues, type ScopeGroup } from './format';
import { IssueCard } from './IssueCard';
import { OpsEstimate } from './OpsEstimate';
import styles from './AnalysisPanel.module.css';

type Analysis = Schemas['Analysis'];
type Issue = Schemas['Issue'];

interface TabProps {
  /** Клиент API; по умолчанию `api` (вкладки реестра `panels.ts` рендерятся без пропсов). */
  client?: ApiClient;
}

/** Общая обёртка вкладок: загрузка анализа и состояния «нет проекта / загрузка / ошибка». */
function WithAnalysis({ client, children }: { client: ApiClient; children: (a: Analysis) => ReactNode }) {
  const { projectId, status, analysis, error } = useAnalysis(client);
  if (!projectId) return <div className={styles.state}>Проект не открыт</div>;
  if (analysis) {
    return (
      <div className={styles.tab}>
        {status === 'error' && (
          <div className={`${styles.state} ${styles.stateError}`} role="alert" data-testid="analysis-stale">
            Не удалось обновить анализ: {error}. Показаны устаревшие данные (версия {analysis.version}).
          </div>
        )}
        {children(analysis)}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className={`${styles.state} ${styles.stateError}`} role="alert">
        Не удалось загрузить анализ: {error}
      </div>
    );
  }
  return <div className={styles.state}>Загрузка анализа…</div>;
}

/** Почему «Применить» неактивна: Quality Gate требует песочницу; одновременно — один прогон. */
function useFixDisabledReason(): string | null {
  const sandboxReason = useSandboxStore(sandboxDisabledReason);
  const sandboxBound = useSandboxStore((s) => s.projectId !== null);
  const busy = useSandboxStore((s) => s.busy);
  const fixRunning = useFixStore((s) => isFixRunning(s.gate));
  if (fixRunning) return 'Уже выполняется Quality Gate';
  if (busy) return busy === 'run' ? 'Идёт запуск программы' : 'Идёт проверка поведения';
  // Без открытого проекта стор песочницы не привязан — блокируем только по известной причине.
  return sandboxBound ? sandboxReason : null;
}

function IssueList({
  analysis,
  groups,
  empty,
}: {
  analysis: Analysis;
  groups: ScopeGroup<Issue>[];
  empty: string;
}) {
  const selectedIssueId = useAppStore((s) => s.selectedIssueId);
  const selectIssue = useAppStore((s) => s.selectIssue);
  const showPanel = useAppStore((s) => s.showPanel);
  const fixDisabledReason = useFixDisabledReason();
  const aiFix = useAiFeature('fix');
  if (groups.length === 0) return <div className={styles.state}>{empty}</div>;
  return (
    <div className={styles.list} role="list">
      {/* Плоский список с ключами по id: карточка не перемонтируется, когда выбор переносит её в другую группу. */}
      {groups.flatMap((g) => [
        groups.length > 1 && <ScopeHeading key={`h-${g.key}`} label={g.label} />,
        ...g.items.map((issue) => (
          <div role="listitem" key={issue.id}>
            <IssueCard
              issue={issue}
              selected={issue.id === selectedIssueId}
              analysisN={analysis.n}
              onSelect={(i) => {
                selectIssue({ issueId: i.id, methodId: i.methodId, blockId: i.blockId });
                // Находка уровня класса/проекта (CyclicDependency: без methodId/blockId) — на холсте её нет,
                // показываем код по span проблемы (вкладка «Код Java» открывает файл span, src/app/codeTarget.ts).
                if (!i.methodId) showPanel('bottom', 'bottom.code');
              }}
              fixDisabledReason={fixDisabledReason}
              onApplyFix={(i, fixId) => runCommand('fix.apply', { issueId: i.id, fixId })}
              onAiFix={aiFix ? (i) => runCommand('ai.fix', { issueId: i.id }) : undefined}
            />
          </div>
        )),
      ])}
    </div>
  );
}

/** Подзаголовок группы; показывается, только если групп больше одной. */
function ScopeHeading({ label }: { label: string }) {
  return (
    <div role="presentation" className={styles.scope} data-testid="scope-heading">
      {label}
    </div>
  );
}

/** Оценка для выбранной проблемы списка, иначе — для первой с opsBefore/opsAfter. */
function estimateIssue(issues: Issue[], selectedIssueId: string | null): Issue | undefined {
  const withOps = (i: Issue) => i.complexity?.opsBefore !== undefined && i.complexity.opsAfter !== undefined;
  const selected = issues.find((i) => i.id === selectedIssueId);
  return selected && withOps(selected) ? selected : issues.find(withOps);
}

function IssuesTab({ client, pick, empty }: { client: ApiClient; pick: 'problems' | 'warnings'; empty: string }) {
  const selectedIssueId = useAppStore((s) => s.selectedIssueId);
  return (
    <WithAnalysis client={client}>
      {(analysis) => (
        <IssuesContent analysis={analysis} pick={pick} empty={empty} selectedIssueId={selectedIssueId} />
      )}
    </WithAnalysis>
  );
}

function IssuesContent({
  analysis,
  pick,
  empty,
  selectedIssueId,
}: {
  analysis: Analysis;
  pick: 'problems' | 'warnings';
  empty: string;
  selectedIssueId: string | null;
}) {
  const currentMethodId = useAppStore((s) => s.selectedMethodId);
  const groups = useMemo(
    () => groupByScope(splitIssues(analysis.issues)[pick], (i) => i.methodId, currentMethodId),
    [analysis.issues, pick, currentMethodId],
  );
  const issues = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  return (
    <>
      <div className={styles.summary} data-testid="issues-summary">
        {issuesSummary(pick, issues)}
      </div>
      <IssueList analysis={analysis} groups={groups} empty={empty} />
      <OpsEstimate issue={estimateIssue(issues, selectedIssueId)} analysisN={analysis.n} />
    </>
  );
}

/** Вкладка «Проблемы»: confidence high, по серьёзности. */
export function ProblemsTab({ client = api }: TabProps) {
  return <IssuesTab client={client} pick="problems" empty="Проблем не найдено" />;
}

/** Вкладка «Предупреждения»: confidence low («возможно…»), без автоисправлений. */
export function WarningsTab({ client = api }: TabProps) {
  return <IssuesTab client={client} pick="warnings" empty="Предупреждений нет" />;
}

/** Вкладка «Метрики»: MethodMetrics из Analysis.metrics; клик по строке выбирает метод. */
export function MetricsTab({ client = api }: TabProps) {
  return <WithAnalysis client={client}>{(analysis) => <MetricsContent analysis={analysis} />}</WithAnalysis>;
}

/** Вложенность > 3 — как порог сворачивания контейнеров (frontend/CLAUDE.md). */
const DEEP_NESTING = 3;

function MetricsContent({ analysis }: { analysis: Analysis }) {
  const selectedMethodId = useAppStore((s) => s.selectedMethodId);
  const selectMethod = useAppStore((s) => s.selectMethod);
  const { metrics } = analysis;
  const groups = useMemo(() => groupByScope(metrics, (m) => m.methodId, selectedMethodId), [metrics, selectedMethodId]);
  const totalLines = metrics.reduce((sum, m) => sum + m.lines, 0);
  const maxNesting = metrics.reduce((max, m) => Math.max(max, m.maxNesting), 0);

  return (
    <>
      <div className={styles.tiles}>
        <Tile value={metrics.length} label="методов" />
        <Tile value={totalLines} label="строк" />
        <Tile value={maxNesting} label="макс. влож." />
      </div>
      {metrics.length === 0 ? (
        <div className={styles.state}>Метрик нет</div>
      ) : (
        <div role="table" aria-label="Метрики методов">
          <div role="row" className={`${styles.mrow} ${styles.mrowHead}`}>
            <span role="columnheader">Метод</span>
            <span role="columnheader">Строк</span>
            <span role="columnheader">Влож.</span>
            <span role="columnheader">Время</span>
          </div>
          {groups.flatMap((g) => [
            groups.length > 1 && <ScopeHeading key={`h-${g.key}`} label={g.label} />,
            ...g.items.map((m) => {
              const on = m.methodId === selectedMethodId;
              const deep = m.maxNesting > DEEP_NESTING ? styles.warn : '';
              return (
                <button
                  key={m.methodId}
                  type="button"
                  role="row"
                  aria-selected={on}
                  className={on ? `${styles.mrow} ${styles.mrowOn}` : styles.mrow}
                  onClick={() => selectMethod(m.methodId)}
                  title={m.methodId}
                >
                  <span role="cell" className={styles.cellName}>
                    {shortMethodName(m.methodId)}
                  </span>
                  <span role="cell">{m.lines}</span>
                  <span role="cell" className={deep}>
                    {m.maxNesting}
                  </span>
                  <span role="cell" className={styles.mono} title={m.complexity}>
                    {m.complexity}
                  </span>
                </button>
              );
            }),
          ])}
        </div>
      )}
    </>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileValue}>{value}</span>
      <span className={styles.tileLabel}>{label}</span>
    </div>
  );
}
