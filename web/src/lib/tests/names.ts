import type { TableJudgment } from "../../../../src/core/types.ts";
import { plainReason } from "../demo.ts";
import type { Check } from "./types.ts";

export const pct = (ok: number, total: number) => (total === 0 ? "n/a" : `${Math.round((100 * ok) / total)}%`);

const POLARITY: Readonly<Record<string, string>> = {
  higher_is_better: "higher is better",
  lower_is_better: "lower is better",
  neutral: "no better direction",
};

/** A check's expected or actual value, in words: "none" → "left plain", "lower_is_better/log" → "lower is better · log". */
export const plain = (value: string): string => {
  if (value === "none") return "left plain";
  if (value === "quantitative") return "shaded, as amounts";
  if (value === "ordinal") return "shaded, as ordered labels";
  if (value.startsWith("ordinal[")) return `ordered labels: ${value.slice(8, -1)}`;
  const [polarity, transform] = value.split("/");
  if (polarity !== undefined && polarity in POLARITY) return `${POLARITY[polarity]}${transform === undefined ? "" : ` · ${transform}`}`;
  return value
    .split("|")
    .map((v) => POLARITY[v] ?? v)
    .join(" or ");
};

/** A check's expected or actual value in words, aware of what the check is about. */
export const describeValue = (kind: string, value: string): string => {
  if (kind === "aggregates") {
    const rows = JSON.parse(value) as number[];
    return rows.length === 0 ? "no totals rows" : `${rows.length === 1 ? "row" : "rows"} ${rows.map((r) => r + 1).join(", ")} as totals`;
  }
  if (kind === "shared") {
    if (value === "one scale") return value;
    const groups = JSON.parse(value) as (string | null)[];
    return groups[0] !== null && groups.every((g) => g === groups[0]) ? "one scale" : "separate scales";
  }
  if (kind === "orientation") return value === "rows" ? "compared across rows" : "compared down columns";
  // A shade-or-not check is about the kind alone; direction and scale have their own checks.
  if (kind === "detect") return value === "none" ? "left plain" : value.startsWith("ordinal") ? plain("ordinal") : plain(value.includes("/") ? "quantitative" : value);
  return plain(value);
};

const p2 = (p: number) => `${Math.round(p * 100)}%`;

/**
 * The probabilities behind one check's judgment, in short: what the model
 * said, so a reader can see how close a call was.
 */
export const evidenceFor = (check: Check, table: TableJudgment): string => {
  if (check.kind === "orientation") return table.rowsScore === null ? "not asked" : `P(rows) ${p2(table.rowsScore)}`;
  if (check.kind === "aggregates" || check.kind === "shared") return "";
  const e = table.encodings.find((x) => x.header === check.column);
  const s = table.skipped.find((x) => x.header === check.column);
  if (check.kind === "detect") {
    if (e !== undefined) return `${e.kind === "ordinal" ? "P(ordered)" : "P(amount)"} ${p2(e.evidence.comparable)}`;
    if (s === undefined) return "";
    return s.comparable === null ? `not asked: ${plainReason(s.reason)}` : `${p2(s.comparable)}: ${plainReason(s.reason)}`;
  }
  if (e === undefined) return "";
  if (check.kind === "polarity") {
    const p = e.evidence.polarity;
    return `higher ${p2(p.higher_is_better)} · lower ${p2(p.lower_is_better)} · neither ${p2(p.neutral)}`;
  }
  if (check.kind === "transform") return e.evidence.log === null ? "not asked" : `P(log) ${p2(e.evidence.log)}`;
  if (check.kind === "order") return e.evidence.orderConfidence === null ? "" : `order confidence ${p2(e.evidence.orderConfidence)}`;
  return "";
};
