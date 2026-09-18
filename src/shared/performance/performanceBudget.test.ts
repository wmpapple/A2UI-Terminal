import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  finishPerformanceMeasurement,
  performanceBudgets,
  readPerformanceMeasurements,
  resetPerformanceMeasurements,
  startPerformanceMeasurement,
} from './performanceBudget';

describe('performance budgets', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetPerformanceMeasurements();
  });

  it('records only timing metadata and evaluates the named budget', () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValue(349.5);
    startPerformanceMeasurement('requestFeedback');
    const measurement = finishPerformanceMeasurement('requestFeedback');

    expect(measurement).toMatchObject({
      name: 'requestFeedback',
      durationMs: 249.5,
      budgetMs: performanceBudgets.requestFeedback,
      withinBudget: true,
    });
    expect(readPerformanceMeasurements()).toEqual([measurement]);
    expect(window.__A2UI_PERFORMANCE__).toEqual([measurement]);
    expect(JSON.stringify(measurement)).not.toMatch(/content|path|title|workspace/i);
  });

  it('does not invent a sample when no matching operation was started', () => {
    expect(finishPerformanceMeasurement('resultOpen')).toBeNull();
    expect(readPerformanceMeasurements()).toEqual([]);
  });
});
