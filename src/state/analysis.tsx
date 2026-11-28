/**
 * Derived analysis selectors. Every analytical value shown in the UI comes from
 * these engine calls for the current dataset + process + analysis-filter scope.
 * Nothing here computes process-mining results itself; it only selects cases
 * (whole cases by first event, per ENGINE_CONTRACT) and routes calls to the
 * provider.
 *
 * Memo inputs are limited to what actually changes the analysis (dataset,
 * process, case-start filter, KPI bucket width, Festival settings, targets).
 * UI-only state — selected case, graph selection, zoom/pan, display filters —
 * never re-runs the engine.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type {
  AnalysisScope,
  CaseDuration,
  DFG,
  Finding,
  ImportOptions,
  KPIContext,
  Metric,
  PerformanceAnalysis,
  ResourceAnalysis,
  TargetEvaluation,
  Trace,
  ValidationResult,
  Variant,
} from '../contracts';
import { blocked, callEngine, chain, realEngine, type EngineApi, type EngineResult } from '../adapters/engineAdapter';
import { uiFixtureEngine } from '../adapters/fixtures/uiFixture';
import { DEFAULT_FESTIVAL_SETTINGS, festivalKpiConfig, festivalRework } from '../festival/adapter';
import { useStore, useWorkspace } from './store';
import { providerFor, scopeOf } from './scope';
import type { DatasetState, ProviderKind } from './types';

export { isScopeStale, providerFor } from './scope';

export interface Analysis {
  provider: ProviderKind;
  api: EngineApi;
  validation: EngineResult<ValidationResult> | null;
  traces: EngineResult<Trace[]> | null;
  processKeys: string[];
  processTraces: Trace[];
  selectedTraces: Trace[];
  scope: AnalysisScope | null;
  dfg: EngineResult<DFG> | null;
  variants: EngineResult<Variant[]> | null;
  durations: EngineResult<CaseDuration[]> | null;
  performance: EngineResult<PerformanceAnalysis> | null;
  resources: EngineResult<ResourceAnalysis> | null;
  kpis: EngineResult<Metric[]> | null;
  findings: EngineResult<Finding[]> | null;
  evaluations: EngineResult<TargetEvaluation[]> | null;
  traceByKey: Map<string, Trace>;
}

export function importOptionsFor(dataset: DatasetState): ImportOptions {
  return {
    mapping: dataset.mapping,
    missingResources: dataset.missingResources,
    fixedOffset: dataset.fixedOffset || undefined,
    acceptExclusions: dataset.acceptExclusions,
    requireProcessType: dataset.requireProcessType,
  };
}

function localToMs(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function firstEventMs(trace: Trace): number | null {
  return trace.events[0]?.timestampMs ?? null;
}

/** Earliest first-event time without spreading large arrays onto the call stack. */
function minFirstEvent(traces: readonly Trace[]): number | null {
  let min: number | null = null;
  for (const t of traces) {
    const v = firstEventMs(t);
    if (v !== null && (min === null || v < min)) min = v;
  }
  return min;
}

const EMPTY_TRACES: Trace[] = [];
const AnalysisContext = createContext<Analysis | null>(null);

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const { state } = useStore();
  const { dataset } = state;
  // Analysis inputs only. selectedCaseKey and other UI state are intentionally excluded.
  const { processKey, dateFrom, dateTo, throughputBucketMin } = state.view;
  const workspace = useWorkspace();
  const provider = providerFor(dataset);
  const api = provider === 'ui_fixture' ? uiFixtureEngine : realEngine;

  const validation = useMemo(
    () => (dataset ? callEngine(api, 'validateAndNormalize', dataset.rows, importOptionsFor(dataset)) : null),
    [api, dataset],
  );

  const traces = useMemo<EngineResult<Trace[]> | null>(() => {
    if (!validation) return null;
    if (validation.status !== 'ok') return blocked('groupCases', validation);
    if (!validation.data.canAnalyze) {
      return { status: 'blocked', fn: 'groupCases', message: 'Validation requires attention before analysis (see Overview & Data).' };
    }
    return callEngine(api, 'groupCases', validation.data.events);
  }, [api, validation]);

  const allTraces = traces?.status === 'ok' ? traces.data : EMPTY_TRACES;

  const processKeys = useMemo(() => [...new Set(allTraces.map((t) => t.processType))].sort(), [allTraces]);

  const processTraces = useMemo(
    () => (processKey ? allTraces.filter((t) => t.processType === processKey) : EMPTY_TRACES),
    [allTraces, processKey],
  );

  const selectedTraces = useMemo(() => {
    const from = localToMs(dateFrom);
    const to = localToMs(dateTo);
    if (from === null && to === null) return processTraces;
    return processTraces.filter((t) => {
      const first = firstEventMs(t);
      if (first === null) return false;
      return (from === null || first >= from) && (to === null || first <= to);
    });
  }, [processTraces, dateFrom, dateTo]);

  const scope = useMemo(() => scopeOf(dataset, { processKey, dateFrom, dateTo }), [dataset, processKey, dateFrom, dateTo]);

  const ready = traces?.status === 'ok' && !!scope;

  // Discovery results depend only on the selected cases.
  const discovery = useMemo(() => {
    if (!ready) return null;
    const t = selectedTraces;
    return {
      dfg: callEngine(api, 'buildDFG', t),
      variants: callEngine(api, 'getVariants', t),
      durations: callEngine(api, 'getCaseDurations', t),
      performance: callEngine(api, 'getPerformance', t),
      resources: callEngine(api, 'getResourceAnalysis', t),
    };
  }, [api, ready, selectedTraces]);

  // Festival settings are passed only when the dataset explicitly enables Festival adapters.
  const festivalSettings = dataset?.festival ? dataset.festivalSettings ?? DEFAULT_FESTIVAL_SETTINGS : null;
  const festivalConfig = useMemo(
    () => (festivalSettings ? festivalKpiConfig(festivalSettings, allTraces) : undefined),
    [festivalSettings, allTraces],
  );
  const rework = useMemo(
    () => (festivalSettings && processKey ? festivalRework(processKey, festivalSettings) : undefined),
    [festivalSettings, processKey],
  );

  const kpis = useMemo(() => {
    if (!ready || !processKey) return null;
    const first = minFirstEvent(selectedTraces);
    const bucketMs = throughputBucketMin * 60_000;
    const context: KPIContext = {
      processKey,
      metadata: dataset?.metadata,
      throughput: { bucketMinutes: throughputBucketMin, anchorMs: first === null ? 0 : Math.floor(first / bucketMs) * bucketMs },
      ...(festivalConfig ? { festival: festivalConfig } : {}),
    };
    return callEngine(api, 'getKPIs', selectedTraces, context);
  }, [api, ready, processKey, selectedTraces, throughputBucketMin, dataset?.metadata, festivalConfig]);

  const targets = workspace?.targets;

  const findings = useMemo<EngineResult<Finding[]> | null>(() => {
    if (!discovery || !kpis || !scope) return null;
    const { dfg, performance, resources } = discovery;
    for (const upstream of [dfg, performance, resources, kpis]) {
      if (upstream.status !== 'ok') return blocked('getFindings', upstream);
    }
    return callEngine(
      api,
      'getFindings',
      {
        scope,
        traces: selectedTraces,
        dfg: (dfg as { data: DFG }).data,
        performance: (performance as { data: PerformanceAnalysis }).data,
        resources: (resources as { data: ResourceAnalysis }).data,
        metrics: (kpis as { data: Metric[] }).data,
        ...(rework ? { rework } : {}),
      },
      targets ?? [],
    );
  }, [api, discovery, kpis, scope, selectedTraces, targets, rework]);

  // Separate memo: a target edit re-evaluates immediately without recomputing metrics.
  const evaluations = useMemo(
    () => (kpis ? chain(kpis, api, 'evaluateTargets', (metrics) => [metrics, targets ?? []]) : null),
    [api, kpis, targets],
  );

  const traceByKey = useMemo(() => new Map(allTraces.map((t) => [t.caseKey, t])), [allTraces]);

  const value = useMemo<Analysis>(
    () => ({
      provider,
      api,
      validation,
      traces,
      processKeys,
      processTraces,
      selectedTraces,
      scope,
      dfg: discovery?.dfg ?? null,
      variants: discovery?.variants ?? null,
      durations: discovery?.durations ?? null,
      performance: discovery?.performance ?? null,
      resources: discovery?.resources ?? null,
      kpis,
      findings,
      evaluations,
      traceByKey,
    }),
    [provider, api, validation, traces, processKeys, processTraces, selectedTraces, scope, discovery, kpis, findings, evaluations, traceByKey],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysis(): Analysis {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error('useAnalysis must be used inside AnalysisProvider');
  return ctx;
}
