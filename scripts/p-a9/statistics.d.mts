export interface RoundSummary {
  roundP50: number[];
  medianP50: number;
  roundP95: number[];
  medianP95: number;
  p95CoefficientOfVariation: number;
  sampleCount: number;
}

export function percentile(values: number[], requestedPercentile: number): number;
export function median(values: number[]): number;
export function summarizeRounds(rounds: number[][]): RoundSummary;
