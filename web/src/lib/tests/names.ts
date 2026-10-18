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
