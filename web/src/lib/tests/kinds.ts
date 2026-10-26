/**
 * The eval check kinds, in the order that the site shows them. Each kind lists
 * its question kinds and its decision rule. The rule reads its thresholds from
 * the policy (DEFAULT_POLICY in src/decide/judge.ts).
 */
import type { Policy } from "../../../../src/decide/judge.ts";
import type { CheckKind } from "./types.ts";

export interface KindInfo {
  readonly kind: CheckKind;
  readonly slug: string;
  readonly title: string;
  readonly short: string;
  /** What the check tests. Each item is one paragraph. */
  readonly about: readonly string[];
  /** Question kinds, as ids with numbers replaced by #. */
  readonly questions: readonly string[];
  /** Returns the decision rule as text. `maxTransposeRows` is MAX_TRANSPOSE_ROWS from judge.ts, read from the build data. */
  readonly rule: (p: Policy, maxTransposeRows: number) => string;
}

export const KINDS: readonly KindInfo[] = [
  {
    kind: "detect",
    slug: "shade-or-not",
    title: "Shade or ignore",
    short: "Is it useful to compare the values in this column?",
    about: [
      "Code sorts each column into numbers, labels, or text. Code does not send text columns to the model.",
      "For a number column, the model tells what the numbers are. Amounts get shading. Code ignores identifiers, years, cutoffs, and records such as 12-4. It ignores ranks that count the rows (1, 2, 3 down the table), but shades other ranks, such as one outlet's ranking beside the table's own. A bracket such as 20–25 or 65+ is an amount when it is a value of the row, such as a median age. Code puts it on the scale at its midpoint. Brackets in the first column that name the rows (0–4, 5–9, 10–14) are like years: code ignores them.",
      "For a label column, the model tells if the labels are grades in a fixed order. Only ordered labels get shading. Code ignores a column with only two labels, unless it shares a scale with a column that has more labels.",
    ],
    questions: ["n#.role", "c#.relation"],
    rule: (p) =>
      `Shade a number column when P(amount) + P(bracket) is ${p.measure} or more. Shade a label column when P(ordered) is ${p.ordinal} or more and the order confidence is ${p.orderConfidence} or more. Also shade it when P(ordered) is ${p.ordinalWithStrongOrder} or more and the order confidence is ${p.strongOrder} or more.`,
  },
  {
    kind: "polarity",
    slug: "direction",
    title: "Which direction is better",
    short: "Is a higher value better, a lower value better, or neither?",
    about: [
      "A low price is better. A high batting average is better. A tall building is not better or worse.",
      "The direction sets which end of the scale gets the good color. When no direction is better, the scale uses one hue. Thus the color does not show a judgment that the data does not have.",
    ],
    questions: ["n#.polarity", "c#.polarity"],
    rule: (p) =>
      `Higher is better when P(higher) is ${p.polarity} or more. If not, lower is better when P(lower) is ${p.polarity} or more. If not, the scale is neutral.`,
  },
  {
    kind: "transform",
    slug: "scale",
    title: "Log or linear scale",
    short: "Are ratios more important than differences?",
    about: [
      "Populations from 50 to 1.4 billion do not show well on a linear scale. Almost all cells get the lightest color. A log scale shows them better.",
      "Code measures the range of the values. Code asks the model only when the largest value is 10 or more times the smallest value. The model tells if ratios between the values are more important than differences.",
    ],
    questions: ["n#.log"],
    rule: (p) => `Use a log scale when P(log) is ${p.log} or more and all values are more than zero.`,
  },
  {
    kind: "order",
    slug: "label-order",
    title: "Order of labels",
    short: "Which label is the lower grade?",
    about: [
      "Ordered labels, such as Small < Medium < Large, get a sequential scale.",
      "The model compares each pair of labels, in the two directions. Code then finds the order that agrees with the most answers. Thus one incorrect answer cannot change the order.",
    ],
    questions: ["c#.lt#_#"],
    rule: (p) =>
      `Use the order that agrees with the most pair answers. Use it only when the mean confidence of those answers is ${p.orderConfidence} or more (${p.strongOrder} or more when P(ordered) is low).`,
  },
  {
    kind: "aggregates",
    slug: "totals",
    title: "Totals and averages",
    short: "Is this row a total?",
    about: [
      "A Total row or an Average row can make the scale too wide. Then all other rows look small.",
      "Code finds the rows that can be totals and asks the model about them. Code ignores total rows: they are not on the scale and not shaded.",
      "A first or last row whose numbers are the sums of the other rows is a total without a question, such as a box score's team row that has no label.",
    ],
    questions: ["row#.aggregate"],
    rule: (p) =>
      `Remove a row from the scale when P(total) is ${p.aggregate} or more, or when it sums the other rows in at least two columns and in two thirds of the numeric columns.`,
  },
  {
    kind: "shared",
    slug: "shared-scales",
    title: "Shared scales",
    short: "Do columns in two tables use one scale?",
    about: [
      "A page can show the prices of two stores in two tables. The same color must then show the same price in the two tables.",
      "Code finds columns in different tables that have the same header and unit. The model tells if they measure the same quantity. If they do, they get one scale that is wide enough for all their values.",
    ],
    questions: ["g#.share", "g#.lt#_#"],
    rule: (p) => `Use one scale when P(same quantity) is ${p.share} or more.`,
  },
  {
    kind: "orientation",
    slug: "orientation",
    title: "Rows or columns",
    short: "Do you compare values down a column or across a row?",
    about: [
      "Some benchmark tables show one benchmark in each row and one model in each column. In these tables, each row is one measure.",
      "When a table has two or more number columns, the model tells which direction to compare. Code reads a row-based table one row at a time, as if each row is a column.",
    ],
    questions: ["table.orientation"],
    rule: (p, rows) =>
      `Read the table by rows when P(rows) is ${p.rows} or more and the table has ${rows} rows or fewer.`,
  },
];

export const kindBySlug = (slug: string) => KINDS.find((k) => k.slug === slug);
