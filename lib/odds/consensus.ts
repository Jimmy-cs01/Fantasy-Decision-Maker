const numeric = (values: Array<number | null | undefined>) =>
  values.filter((value): value is number => value != null && Number.isFinite(value));

export function median(values: Array<number | null | undefined>): number | null {
  const sorted = numeric(values).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function consensusLine<T>(rows: T[], read: (row: T) => number | null) {
  return median(rows.map(read));
}
