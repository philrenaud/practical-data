/**
 * Orders labels from pairwise judgments.
 *
 * Each pair (i, j) has p, the probability that label i is the lower grade.
 * Label i scores p for the pair and label j scores 1 - p. Sorting by total
 * score is a soft Copeland count, which tolerates a single bad comparison.
 */

/**
 * Returns the labels from lowest to highest, and the mean probability of the
 * chosen direction of each pair. `lower(i, j)` is the probability that label
 * i is lower than label j, for i < j.
 */
export const orderFromPairs = (
  labels: readonly string[],
  lower: (i: number, j: number) => number,
): { readonly order: string[]; readonly confidence: number } => {
  const n = labels.length;
  const score = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = lower(i, j);
      score[i]! += p;
      score[j]! += 1 - p;
    }
  }
  const ranked = labels.map((_, i) => i).sort((a, b) => score[b]! - score[a]! || a - b);
  const rank = new Array<number>(n);
  ranked.forEach((label, r) => (rank[label] = r));
  let agree = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = lower(i, j);
      agree += rank[i]! < rank[j]! ? p : 1 - p;
      pairs++;
    }
  }
  return { order: ranked.map((i) => labels[i]!), confidence: pairs === 0 ? 0 : agree / pairs };
};

/** A finishing place such as "3rd", "T-4th", or "7th (tie)". */
const PLACE_RE = /^(?:t-?|=)?(\d+)(?:st|nd|rd|th)(?:\s*\((?:t|tie|tied)\))?$/;

/** Returns the number of a finishing place ("7th (tie)" is 7), or null for any other label. */
export const placeNumber = (label: string): number | null => {
  const m = PLACE_RE.exec(label.trim().toLowerCase());
  return m === null ? null : Number(m[1]);
};

/**
 * Returns labels that are all finishing places, from the worst place to the
 * best, or null when any label is not a place. Code reads the numbers, so the
 * model is not asked to order 3rd, 6th, 14th, and 15th pair by pair. Ties
 * ("7th (tie)") sit next to the place they share.
 */
export const placeOrder = (labels: readonly string[]): string[] | null => {
  const places = labels.map(placeNumber);
  if (places.some((n) => n === null)) return null;
  return labels
    .map((l, i) => ({ l, n: places[i]! }))
    .sort((a, b) => b.n - a.n)
    .map((x) => x.l);
};
