/**
 * Takes one table's judgment off the page's shared scales. A shared scale
 * puts the same value on the same color in every member table, which can wash
 * out the differences inside one table. Isolating rescales that table to its
 * own values and leaves the other members' shared scale untouched.
 */
import type { TableJudgment } from "./types.ts";

const extent = (values: readonly (number | null)[], exclude: ReadonlySet<number>): [number, number] => {
  let lo = Infinity;
  let hi = -Infinity;
  values.forEach((v, i) => {
    if (v === null || exclude.has(i)) return;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  });
  return [lo, hi];
};

/**
 * Rescales every encoding that shares a scale (`group` set) to the table's
 * own values: a quantitative domain shrinks to the column's own extent, and
 * an ordinal order keeps only the levels the column shows. `group` becomes
 * null, so the hover card stops naming other tables.
 */
export const isolateJudgment = (t: TableJudgment): TableJudgment => {
  if (!t.encodings.some((e) => e.group !== null)) return t;
  const aggregate = new Set(t.aggregateRows);
  return {
    ...t,
    encodings: t.encodings.map((e) => {
      if (e.group === null) return e;
      if (e.kind === "quantitative") {
        const domain = extent(e.values, aggregate);
        // The group's log transform needs a positive domain; this table's own may not be.
        const transform = e.transform === "log" && domain[0] <= 0 ? "linear" : e.transform;
        return { ...e, domain, transform, group: null };
      }
      const used = new Set(e.values.filter((v) => v !== null));
      // A single level spans no ramp, so the shared order is kept.
      if (used.size < 2) return { ...e, group: null };
      const kept = e.order
        .map((level, i) => [level, e.labels[i] ?? level] as const)
        .filter(([level]) => used.has(level));
      return { ...e, order: kept.map(([level]) => level), labels: kept.map(([, label]) => label), group: null };
    }),
  };
};
