function sorted(values) {
  if (values.length === 0) {
    throw new Error("At least one value is required");
  }

  return [...values].sort((left, right) => left - right);
}

export function percentile(values, requestedPercentile) {
  if (requestedPercentile <= 0 || requestedPercentile > 100) {
    throw new Error("Percentile must be greater than 0 and at most 100");
  }

  const ordered = sorted(values);
  const index = Math.ceil((requestedPercentile / 100) * ordered.length) - 1;
  return ordered[index];
}

export function median(values) {
  const ordered = sorted(values);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle];
  return (ordered[middle - 1] + ordered[middle]) / 2;
}

export function summarizeRounds(rounds) {
  if (rounds.length === 0) {
    throw new Error("At least one round is required");
  }

  const roundP50 = rounds.map((round) => percentile(round, 50));
  const roundP95 = rounds.map((round) => percentile(round, 95));
  const mean = roundP95.reduce((sum, value) => sum + value, 0) / roundP95.length;
  const variance = roundP95.reduce((sum, value) => sum + (value - mean) ** 2, 0) / roundP95.length;

  return {
    roundP50,
    medianP50: median(roundP50),
    roundP95,
    medianP95: median(roundP95),
    p95CoefficientOfVariation: mean === 0 ? 0 : Math.sqrt(variance) / mean,
    sampleCount: rounds.reduce((sum, round) => sum + round.length, 0),
  };
}
