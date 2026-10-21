import { isDateUnit } from "../../../../src/core/dates.ts";
import type { TableJudgment } from "../../../../src/core/types.ts";
import { plainReason, POLARITY } from "../demo.ts";
import type { Check } from "./types.ts";

// POLARITY, indexed by the plain strings in check values.
const DIRECTIONS: Readonly<Record<string, string>> = POLARITY;

export const pct = (ok: number, total: number) => (total === 0 ? "n/a" : `${Math.round((100 * ok) / total)}%`);

/** Returns a check value in plain words. For example, "lower_is_better/log" becomes "lower is better · log". */
export const plain = (value: string): string => {
  if (value === "none") return "ignored";
  if (value === "quantitative") return "amounts";
  if (value === "ordinal") return "ordered labels";
  if (value.startsWith("ordinal[")) return `ordered labels: ${value.slice(8, -1)}`;
  const [polarity, transform] = value.split("/");
  if (polarity !== undefined && polarity in DIRECTIONS)
    return `${DIRECTIONS[polarity]}${transform === undefined ? "" : ` · ${transform}`}`;
  return value
    .split("|")
    .map((v) => DIRECTIONS[v] ?? v)
    .join(" or ");
};

/** Returns a check value in plain words, for a check of kind `kind`. */
export const describeValue = (kind: string, value: string): string => {
  if (kind === "aggregates") {
    const rows = JSON.parse(value) as number[];
    return rows.length === 0
      ? "no totals rows"
      : `${rows.length === 1 ? "row" : "rows"} ${rows.map((r) => r + 1).join(", ")} as totals`;
  }
  if (kind === "shared") {
    if (value === "one scale") return value;
    const groups = JSON.parse(value) as (string | null)[];
    return groups[0] !== null && groups.every((g) => g === groups[0]) ? "one scale" : "separate scales";
  }
  if (kind === "orientation") return value === "rows" ? "compared across rows" : "compared down columns";
  // A detect check is about the column kind only. Direction and scale have their own checks.
  if (kind === "detect")
    return value === "none"
      ? "ignored"
      : value.startsWith("ordinal")
        ? plain("ordinal")
        : plain(value.includes("/") ? "quantitative" : value);
  return plain(value);
};

const p2 = (p: number) => `${Math.round(p * 100)}%`;

/**
 * Returns the model probabilities behind a check's judgment, in short form.
 * Returns an empty string when there is nothing to show.
 */
export const evidenceFor = (check: Check, table: TableJudgment): string => {
  if (check.kind === "orientation") return table.rowsScore === null ? "not asked" : `P(rows) ${p2(table.rowsScore)}`;
  if (check.kind === "aggregates" || check.kind === "shared") return "";
  const e = table.encodings.find((x) => x.header === check.column);
  const s = table.skipped.find((x) => x.header === check.column);
  if (e?.kind === "quantitative" && isDateUnit(e.unit)) return check.kind === "detect" ? "not asked: dates" : "";
  if (check.kind === "detect") {
    if (e !== undefined) return `${e.kind === "ordinal" ? "P(ordered)" : "P(amount)"} ${p2(e.evidence.comparable)}`;
    if (s === undefined) return "";
    return s.comparable === null
      ? `not asked: ${plainReason(s.reason)}`
      : `${p2(s.comparable)}: ${plainReason(s.reason)}`;
  }
  if (e === undefined) return "";
  if (check.kind === "polarity") {
    const p = e.evidence.polarity;
    return `higher ${p2(p.higher_is_better)} · lower ${p2(p.lower_is_better)} · neither ${p2(p.neutral)}`;
  }
  if (check.kind === "transform") return e.evidence.log === null ? "not asked" : `P(log) ${p2(e.evidence.log)}`;
  if (check.kind === "order")
    return e.evidence.orderConfidence === null ? "" : `order confidence ${p2(e.evidence.orderConfidence)}`;
  return "";
};
