/**
 * Cell text → number. Deliberately conservative: anything ambiguous (dates,
 * clock times, "35-10" scores) returns null so it never pollutes a scale.
 * Ranges ("20–25") parse to their midpoint and keep their bounds.
 */

export interface ParsedNumber {
  readonly value: number;
  /** Normalized unit: a currency symbol, "%", "x", or a trailing word like "GB". */
  readonly unit: string | null;
  /** Written with a comparator ("≤ 272K", "> 200K", "65+"): a bound, not an exact amount. */
  readonly bound: boolean;
  /** For ranges ("20–25"), the low and high ends; `value` is the midpoint. */
  readonly range: readonly [number, number] | null;
}

const MISSING = new Set([
  "", "-", "–", "—", "−", "n/a", "na", "n.a.", "none", "null", "nil", "?", "tbd", "tba",
  "not applicable", "not available", "unknown", "—n/a—", "…", "...",
  "..", // Statistics Canada: not available
]);

const MAGNITUDE: Readonly<Record<string, number>> = {
  k: 1e3, thousand: 1e3,
  m: 1e6, mm: 1e6, mn: 1e6, million: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9,
  t: 1e12, tn: 1e12, trillion: 1e12,
};

const CURRENCY = "$€£¥₹₩₽₺";

const NUMBER_RE = new RegExp(
  "^" +
    "([≤≥<>~≈]=?\\s*)?" + // comparator prefix, e.g. "≤ 272K"
    "([+\\-−]?)\\s*" + // sign before currency
    "(?:(US\\$|A\\$|C\\$|[" + CURRENCY + "])\\s*)?" +
    "([+\\-−]?)" + // sign after currency
    "(\\d{1,3}(?:[,\\u2009\\u202f ]\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|\\.\\d+)" +
    "\\s*" +
    "(%|[x×]|[a-zA-Zµ°/]{1,9}(?:\\s?[a-zA-Z/]{1,6})?)?" +
    "$",
);

/** Heights like 6' 6", 5′11″, 6 ft 2 in. Converted to inches. "6-2" stays ambiguous (scores, records). */
const FEET_INCHES_RE =
  /^(\d{1,2})\s*(?:'|′|ft\.?|feet)\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|″|''|in\.?|inches)?)?$/i;

/** Strips footnote markers such as "[12]", "[a]", "*", "†", and a trailing lone digit after a letter. */
export const stripNoise = (text: string): string =>
  text
    .replace(/\[[^\]]{1,6}\]/g, "")
    .replace(/[*†‡§¶]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

/** Placeholders, including dash-decorated ones such as "— N/a". */
export const isMissing = (text: string): boolean => {
  const t = stripNoise(text).toLowerCase();
  return MISSING.has(t) || MISSING.has(t.replace(/^[\s\-–—−]+|[\s\-–—−]+$/g, ""));
};

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const DATE_RE = new RegExp(
  [
    "^\\d{4}-\\d{2}-\\d{2}", // ISO date
    "^\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4}\\b", // 9/29/2026
    `^${MONTH}\\s+\\d{1,2}\\b`, // Sep 29, Sept 29 2026
    `^\\d{1,2}\\s+${MONTH}\\s+\\d{2,4}`, // 29 Sep 2026
    "^\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)$", // 7:07 pm (bare 2:59 is a duration)
  ].join("|"),
  "i",
);

/** Dates and clock times: ordered, but by the calendar, which is not something to shade. */
export const isDateLike = (raw: string): boolean => DATE_RE.test(stripNoise(raw));

/**
 * Clock-style durations: "2:59" (h:mm or m:ss) and "1:02:03" (h:mm:ss).
 * Read as base-60 numbers, a:b → a·60 + b, so 3:00 is one more than 2:59.
 * Within a column the format is consistent, which is all a scale needs.
 */
const DURATION_RE = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/;

/** One number, no ranges. */
const parseSingle = (input: string): ParsedNumber | null => {
  let text = input;
  const clock = DURATION_RE.exec(text);
  if (clock !== null) {
    const [, a = "0", b = "0", c] = clock;
    const value = c === undefined ? Number(a) * 60 + Number(b) : Number(a) * 3600 + Number(b) * 60 + Number(c);
    return { value, unit: ":", bound: false, range: null };
  }
  let negative = false;
  // Accounting negatives: "($3.00)".
  const paren = /^\((.*)\)$/.exec(text);
  if (paren?.[1] !== undefined) {
    text = paren[1].trim();
    negative = true;
  }
  const feet = FEET_INCHES_RE.exec(text);
  if (feet !== null) {
    return { value: Number(feet[1]) * 12 + Number(feet[2] ?? 0), unit: "in", bound: false, range: null };
  }
  const m = NUMBER_RE.exec(text);
  if (m === null) return null;
  const [, comparator, signA = "", currency, signB = "", digits = "", suffixRaw] = m;
  const value = Number(digits.replace(/[,   ]/g, ""));
  if (!Number.isFinite(value)) return null;

  const sign = signA || signB;
  if (sign === "-" || sign === "−") negative = !negative;

  let unit: string | null = currency === undefined ? null : currency.replace(/^US/, "");
  let scaled = value;
  if (suffixRaw !== undefined) {
    const suffix = suffixRaw.trim();
    const lower = suffix.toLowerCase();
    const magnitude = MAGNITUDE[lower];
    if (magnitude !== undefined && (suffix !== "m" || unit !== null)) {
      // Bare lowercase "m" is meters unless a currency precedes it.
      scaled = value * magnitude;
    } else if (suffix === "%" ) {
      unit = "%";
    } else if (suffix === "x" || suffix === "×") {
      unit = "x";
    } else {
      // Ordinals ("1st") and units ("GB") are both letters; ordinals are ranks, not amounts.
      if (/^(st|nd|rd|th)$/i.test(suffix)) return null;
      unit = unit ?? suffix;
    }
  }
  return {
    value: negative ? -scaled : scaled,
    unit,
    bound: comparator !== undefined && !/^[~≈]/.test(comparator),
    range: null,
  };
};

const RANGE_SEPARATOR = /\s*(?:–|—|-|\bto\b)\s*/g;

/**
 * "20-25", "26–30", "$10 to $20", "1.5-2.5 GB". Both ends must parse, the low
 * end must be strictly lower, and units must agree, which rules out scores
 * and records written high-first ("35-10") and year-months ("2024-01").
 * Low-first records ("4-12") still parse; the model's `record` role catches those.
 */
const parseRange = (text: string): ParsedNumber | null => {
  for (const m of text.matchAll(RANGE_SEPARATOR)) {
    if (m.index === 0) continue;
    const lo = parseSingle(text.slice(0, m.index));
    const hi = parseSingle(text.slice(m.index + m[0].length));
    if (lo === null || hi === null || lo.bound || hi.bound) continue;
    if (lo.unit !== null && hi.unit !== null && lo.unit !== hi.unit) continue;
    if (!(lo.value < hi.value)) continue;
    return { value: (lo.value + hi.value) / 2, unit: hi.unit ?? lo.unit, bound: false, range: [lo.value, hi.value] };
  }
  return null;
};

/** Parses one cell. Returns null for missing, non-numeric, or ambiguous text. */
export const parseNumber = (raw: string): ParsedNumber | null => {
  const text = stripNoise(raw);
  // Open-ended bins: "65+".
  const plus = /^(.*\d)\s*\+$/.exec(text);
  if (plus?.[1] !== undefined) {
    const n = parseSingle(plus[1]);
    return n === null ? null : { ...n, bound: true };
  }
  return parseSingle(text) ?? parseRange(text);
};



/** Normalizes a categorical label for grouping: trims noise, collapses case. */
export const normalizeLabel = (raw: string): string => stripNoise(raw).toLowerCase();
