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
