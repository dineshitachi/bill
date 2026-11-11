export type FreightAllocationBasis = "QUANTITY" | "CATALOG_VALUE";

export function allocateFreightCents(total: number, weights: number[]): number[] {
  if (!Number.isFinite(total) || total < 0) throw new Error("Freight total must be finite and non-negative");
  if (!weights.length || weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
    throw new Error("Freight allocation weights must be finite and positive");
  }
  const totalCents = Math.round(total * 100);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(weightTotal) || weightTotal <= 0) throw new Error("Freight allocation weights must have a positive finite total");
  const exactShares = weights.map((weight) => totalCents * (weight / weightTotal));
  const cents = exactShares.map(Math.floor);
  let remainder = totalCents - cents.reduce((sum, value) => sum + value, 0);
  const remainderOrder = exactShares.map((share, index) => ({ index, fraction: share - cents[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < remainder; index += 1) cents[remainderOrder[index].index] += 1;
  remainder = totalCents - cents.reduce((sum, value) => sum + value, 0);
  if (remainder !== 0) throw new Error("Freight allocation did not balance");
  return cents;
}