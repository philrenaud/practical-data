/**
 * Parses cell text as a number. The parser is conservative. Ambiguous text,
 * such as dates, clock times, and "35-10" scores, returns null, so it never
 * enters a scale. A range ("20–25") parses to its midpoint and keeps its ends.
 */

export interface ParsedNumber {
  readonly value: number;
  /** The normalized unit: a currency symbol, "%", "x", or a trailing word such as "GB". */
  readonly unit: string | null;
  /** True when written with a comparator ("≤ 272K", "> 200K", "65+"). The value is a bound, not an exact amount. */
  readonly bound: boolean;
  /** The low and high ends of a range ("20–25"). For a range, `value` is the midpoint. */
  readonly range: readonly [number, number] | null;
}

const MISSING = new Set([
  "",
  "-",
  "–",
  "—",
  "−",
  "n/a",
  "na",
  "n.a.",
  "none",
  "null",
  "nil",
  "?",
  "tbd",
  "tba",
  "not applicable",
  "not available",
  "unknown",
  "—n/a—",
  "…",
  "...",
  "..", // Statistics Canada: not available
]);

const MAGNITUDE: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  t: 1e12,
  tn: 1e12,
  trillion: 1e12,
};

const CURRENCY = "$€£¥₹₩₽₺";

const NUMBER_RE = new RegExp(
  "^" +
    "([≤≥<>~≈]=?\\s*)?" + // comparator prefix, e.g. "≤ 272K"
    "([+\\-−]?)\\s*" + // sign before currency
    "(?:(US\\$|A\\$|C\\$|[" +
    CURRENCY +
    "])\\s*)?" +
    "([+\\-−]?)" + // sign after currency
    "(\\d{1,3}(?:[,\\u2009\\u202f ]\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|\\.\\d+)" +
    "\\s*" +
    "(%|[x×]|[a-zA-Zµ°/]{1,9}(?:\\s?[a-zA-Z/]{1,6})?)?" +
    "$",
);

/** Heights such as 6' 6", 5′11″, and 6 ft 2 in, in inches. "6-2" stays ambiguous because scores and records use that form. */
const FEET_INCHES_RE = /^(\d{1,2})\s*(?:'|′|ft\.?|feet)\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|″|''|in\.?|inches)?)?$/i;

/** Removes footnote markers ("[12]", "[a]", and a trailing "*", "†", "‡", "§", or "¶") and collapses whitespace. */
export const stripNoise = (text: string): string =>
  text
    .replace(/\[[^\]]{1,6}\]/g, "")
    .replace(/[*†‡§¶]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

/** True for placeholders such as "N/A", "—", or "..", including ones wrapped in dashes ("— N/a"). */
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

/** True for dates and clock times, which never parse as numbers. Dates that dates.ts can read are shaded as time. */
export const isDateLike = (raw: string): boolean => DATE_RE.test(stripNoise(raw));

/**
 * Clock-style durations: "2:59" (h:mm or m:ss) and "1:02:03" (h:mm:ss). They
 * parse as base-60 numbers, so a:b is a × 60 + b, and 3:00 is one more than
 * 2:59. A column uses one format, so the order is correct whichever unit the
 * column means.
 */
const DURATION_RE = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/;

/** Unicode fractions, as in games behind ("6½"). */
const VULGAR: Readonly<Record<string, number>> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};
const VULGAR_RE = /^(\d*)\s*([½¼¾⅓⅔⅛⅜⅝⅞])$/;

/** Parses one number. parseRange handles ranges. */
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
  const half = VULGAR_RE.exec(text);
  if (half !== null) {
    const value = Number(half[1] || 0) + VULGAR[half[2]!]!;
    return { value: negative ? -value : value, unit: null, bound: false, range: null };
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
    const magnitude = Object.hasOwn(MAGNITUDE, lower) ? MAGNITUDE[lower] : undefined;
    if (magnitude !== undefined && (suffix !== "m" || unit !== null)) {
      // Bare lowercase "m" is meters unless a currency precedes it.
      scaled = value * magnitude;
    } else if (suffix === "%") {
      unit = "%";
    } else if (suffix === "x" || suffix === "×") {
      unit = "x";
    } else {
      // Ordinals ("1st") and units ("GB") are both letters. Ordinals are ranks, not amounts.
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
 * Parses a range such as "20-25", "26–30", "$10 to $20", or "1.5-2.5 GB". Both
 * ends must parse, the low end must be strictly lower, and the units must
 * agree. These rules reject scores and records written high first ("35-10")
 * and year-months ("2024-01"). Records written low first ("4-12") still
 * parse. The model's `record` role rejects those.
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

/** A signed change after a value, as in "740 (-16)" or "2.4% (+0.3%)". The sign is required. */
const CHANGE_RE = /^(.*\S)\s+\(\s*[+\-−±]\s*\d[\d,.]*\s*%?\s*\)$/;

/** Parses one cell. Returns null for missing, non-numeric, or ambiguous text. */
export const parseNumber = (raw: string): ParsedNumber | null => {
  const text = stripNoise(raw);
  // A value followed by its change: the value is the cell's number.
  const change = CHANGE_RE.exec(text);
  if (change?.[1] !== undefined) return parseNumber(change[1]);
  // Open-ended bins: "65+".
  const plus = /^(.*\d)\s*\+$/.exec(text);
  if (plus?.[1] !== undefined) {
    const n = parseSingle(plus[1]);
    return n === null ? null : { ...n, bound: true };
  }
  return parseSingle(text) ?? parseRange(text);
};

/** Normalizes a category label for grouping. It removes footnote markers and lowercases the text. */
export const normalizeLabel = (raw: string): string => stripNoise(raw).toLowerCase();
