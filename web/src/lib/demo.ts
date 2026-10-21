/**
 * The home page examples. Each one is a real table and the judgment that the
 * extension made for it. scripts/demo-data.ts writes them to demo/data.json.
 * The site never calls a model.
 */
import { isDateUnit } from "../../../src/core/dates.ts";
import type { ColumnEncoding, PageJudgment, PageSnapshot } from "../../../src/core/types.ts";
import data from "../../../demo/data.json";

export interface DemoSection {
  readonly section: {
    readonly id: string;
    readonly heading: string;
    readonly source: string;
    readonly caption: string;
  };
  readonly page: PageSnapshot;
  readonly judgment: PageJudgment;
}

export const sections = data as unknown as readonly DemoSection[];

/** Returns the number of columns in each shared-scale group of a page. */
export const groupSizes = (judgment: PageJudgment): ReadonlyMap<string, number> => {
  const sizes = new Map<string, number>();
  for (const t of judgment.tables)
    for (const e of t.encodings) if (e.group !== null) sizes.set(e.group, (sizes.get(e.group) ?? 0) + 1);
  return sizes;
};

/** Plain words for the reasons that the judge leaves a column unshaded. */
const REASONS: Readonly<Record<string, string>> = {
  "looks like time": "a point in time (year, season, age)",
  "looks like identifier": "an identifier, not an amount",
  "looks like rank": "a rank, not an amount",
  "looks like threshold": "a cutoff, not an amount",
  "looks like bins": "brackets that name the rows",
  "labels look like unordered kinds": "labels with no natural order",
  "labels look like names or versions": "names or versions",
  "labels look like workflow states": "stages of a process",
  "labels look like options": "alternative options",
  "every value is unique": "names",
  "too many distinct values": "names or free text",
  "values are long text": "free text",
  "dates or times": "dates",
  "only two levels": "only two levels",
  constant: "every value is the same",
};

export const POLARITY: Readonly<Record<ColumnEncoding["polarity"], string>> = {
  higher_is_better: "higher is better",
  lower_is_better: "lower is better",
  neutral: "no better direction",
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

export const plainReason = (reason: string | undefined): string => REASONS[reason ?? ""] ?? reason ?? "not comparable";

export const describeEncoding = (e: ColumnEncoding): string =>
  e.kind === "quantitative" && isDateUnit(e.unit)
    ? "dates · earliest to latest"
    : e.kind === "quantitative"
      ? `${POLARITY[e.polarity]} · ${e.transform} scale${e.group === null ? "" : " · shared"}`
      : `ordered: ${e.order.join(" → ")}`;

export const confidenceOf = (e: ColumnEncoding): string =>
  e.kind === "quantitative" && isDateUnit(e.unit)
    ? "decided by code"
    : e.kind === "quantitative"
      ? `measure ${pct(e.evidence.comparable)} · direction ${pct(Math.max(...Object.values(e.evidence.polarity)))}`
      : `ordered ${pct(e.evidence.comparable)} · order ${pct(e.evidence.orderConfidence ?? 0)}`;
