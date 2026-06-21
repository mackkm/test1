export function computeRetailPrice(costPrice: number, markupMultiplier: number): number {
  if (!Number.isFinite(costPrice) || costPrice < 0) {
    throw new Error(`costPrice must be a non-negative number, got ${costPrice}`);
  }
  if (!Number.isFinite(markupMultiplier) || markupMultiplier <= 0) {
    throw new Error(`markupMultiplier must be a positive number, got ${markupMultiplier}`);
  }
  return Math.round(costPrice * markupMultiplier * 100) / 100;
}
