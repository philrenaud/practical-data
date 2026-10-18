/**
 * The categories of eval check, in reading order. Each names the question
 * kinds behind it and the policy threshold that turns probabilities into a
 * decision (src/decide/judge.ts, DEFAULT_POLICY).
 */
import type { Policy } from "../../../../src/decide/judge.ts";
import type { CheckKind } from "./types.ts";

export interface KindInfo {
  readonly kind: CheckKind;
  readonly slug: string;
  readonly title: string;
  readonly short: string;
  /** What the check proves, in a paragraph. */
  readonly about: string;
  /** Question kinds, as ids with numbers replaced by #. */
  readonly questions: readonly string[];
  /** `maxTransposeRows` is MAX_TRANSPOSE_ROWS from judge.ts, passed in from the build data. */
  readonly rule: (p: Policy, maxTransposeRows: number) => string;
}

export const KINDS: readonly KindInfo[] = [
  {
    kind: "detect",
    slug: "shade-or-not",
    title: "Shade or leave plain",
    short: "Is this column worth comparing at all?",
    about:
      "Code first sorts each column into numbers, labels, or text it never sends. For numbers, the model says what kind of number it is: an amount worth comparing, or an identifier, a year, a rank, a record like 12-4, or a cutoff. Brackets like 20-25 or 65+ count as amounts and are placed by their midpoints. For labels, whether they are ordered grades; labels with only two levels stay plain unless a shared scale widens them. Every hand-labeled column is scored: shaded when it should be, left plain when it shouldn't.",
    questions: ["n#.role", "c#.relation"],
    rule: (p) =>
      `Shade numbers when P(amount) + P(brackets) ≥ ${p.measure}. Shade labels when P(ordered) ≥ ${p.ordinal} and the recovered order holds at ≥ ${p.orderConfidence}, or P(ordered) ≥ ${p.ordinalWithStrongOrder} with the order at ≥ ${p.strongOrder}.`,
  },
  {
    kind: "polarity",
    slug: "direction",
    title: "Which way is better",
    short: "Higher better, lower better, or neither?",
    about:
      "A price is better low; a batting average is better high; a building's height is neither. The direction decides which end of the scale gets the good color. Neither means a neutral sequential scale, so the colors don't imply a judgment the data doesn't carry.",
    questions: ["n#.polarity", "c#.polarity"],
    rule: (p) => `Higher is better if P(higher) ≥ ${p.polarity}, else lower is better if P(lower) ≥ ${p.polarity}; otherwise the neutral scale.`,
  },
  {
    kind: "transform",
    slug: "scale",
    title: "Log or linear",
    short: "Do ratios matter more than differences?",
    about:
      "Populations from 50 to 1.4 billion, or prices from $0.02 to $75, flatten into one color on a linear scale. Code measures the spread and asks only when it spans at least an order of magnitude; the model says whether the quantity behaves multiplicatively.",
    questions: ["n#.log"],
    rule: (p) => `Asked only when values span at least one order of magnitude; log scale when P(log) ≥ ${p.log} and every value is positive.`,
  },
  {
    kind: "order",
    slug: "label-order",
    title: "Order of labels",
    short: "Which grade is lower?",
    about:
      "Ordered labels (Lightweight < Versatile < Powerful, or Low < Medium < High) get a sequential scale once their order is known; with only two levels they stay plain unless a shared scale widens them. The model compares every pair of labels in both directions; code recovers the order from those comparisons, so one contradictory answer can't flip it.",
    questions: ["c#.lt#_#"],
    rule: (p) => `The order is the one most consistent with every pairwise answer; it's used when its mean confidence reaches ${p.orderConfidence} (or ${p.strongOrder} for weakly ordered labels).`,
  },
  {
    kind: "aggregates",
    slug: "totals",
    title: "Totals and averages",
    short: "Is this row a total?",
    about:
      "A Total or Average row would stretch the scale and make every other row look small. Rows that might be totals are asked about, and the ones judged to be are kept out of the scale and left plain.",
    questions: ["row#.aggregate"],
    rule: (p) => `Keep a row out of the scale when P(total) ≥ ${p.aggregate}.`,
  },
  {
    kind: "shared",
    slug: "shared-scales",
    title: "Shared scales",
    short: "Should two tables' columns share one scale?",
    about:
      "Two stores' prices, or one vendor table per model family, mean the same thing across tables, so the same color should mean the same price. Same-named columns across a page's tables are asked about together; shared ones get one widened scale.",
    questions: ["g#.share", "g#.lt#_#"],
    rule: (p) => `Share a scale when P(same measure) ≥ ${p.share}.`,
  },
  {
    kind: "orientation",
    slug: "orientation",
    title: "Rows or columns",
    short: "Are values compared down columns or across rows?",
    about:
      "Benchmark tables list benchmarks as rows and models as columns, so each row is one measure. When several numeric columns could be read either way, the model is asked, and a row-oriented table is judged transposed.",
    questions: ["table.orientation"],
    rule: (p, rows) => `Judge the table transposed when P(rows) ≥ ${p.rows} and it has at most ${rows} rows.`,
  },
];

export const kindBySlug = (slug: string) => KINDS.find((k) => k.slug === slug);
