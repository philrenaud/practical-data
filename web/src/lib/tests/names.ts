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
  return plain(value);
};
