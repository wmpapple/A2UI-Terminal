export const performanceBudgets = {
  homeInteractive: 2_500,
  resultOpen: 1_000,
  requestFeedback: 300,
} as const;

export type PerformanceMetricName = keyof typeof performanceBudgets;

export interface PerformanceMeasurement {
  name: PerformanceMetricName;
  durationMs: number;
  budgetMs: number;
  withinBudget: boolean;
  measuredAt: string;
}

declare global {
  interface Window {
    __A2UI_PERFORMANCE__?: PerformanceMeasurement[];
  }
}

const starts = new Map<PerformanceMetricName, number>();
const measurements: PerformanceMeasurement[] = [];
const MAX_MEASUREMENTS = 30;

const clock = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

export function startPerformanceMeasurement(name: PerformanceMetricName): void {
  starts.set(name, clock());
}

export function finishPerformanceMeasurement(
  name: PerformanceMetricName
): PerformanceMeasurement | null {
  const startedAt = starts.get(name);
  if (startedAt === undefined) return null;
  starts.delete(name);

  const budgetMs = performanceBudgets[name];
  const durationMs = Math.max(0, Math.round((clock() - startedAt) * 10) / 10);
  const measurement: PerformanceMeasurement = {
    name,
    durationMs,
    budgetMs,
    withinBudget: durationMs <= budgetMs,
    measuredAt: new Date().toISOString(),
  };
  measurements.push(measurement);
  if (measurements.length > MAX_MEASUREMENTS) measurements.shift();
  if (typeof window !== 'undefined') window.__A2UI_PERFORMANCE__ = [...measurements];
  return measurement;
}

export function readPerformanceMeasurements(): readonly PerformanceMeasurement[] {
  return [...measurements];
}

export function resetPerformanceMeasurements(): void {
  starts.clear();
  measurements.length = 0;
  if (typeof window !== 'undefined') window.__A2UI_PERFORMANCE__ = [];
}
