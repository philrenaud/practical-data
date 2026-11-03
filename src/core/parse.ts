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

/** How a page writes numbers: dot-decimal ("1,234.56") or comma-decimal ("1.234,56"). */
export type NumberConvention = "dot-decimal" | "comma-decimal";

/**
 * Primary language subtags whose standard number format is comma-decimal.
 * Spanish is missing on purpose: Spain and Argentina write "1.234,56" while
 * Mexico and most of Central America write "1,234.56", and a bare "es" does
 * not say which, so Spanish pages keep the dot-decimal reading.
 */
const COMMA_DECIMAL_LANGS = new Set([
  "af",
  "az",
  "be",
  "bg",
  "bs",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "et",
  "eu",
  "fi",
  "fr",
  "gl",
  "hr",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ka",
  "kk",
  "lt",
  "lv",
  "mk",
  "nb",
  "nl",
  "nn",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sq",
  "sr",
  "sv",
  "tr",
  "uk",
  "uz",
  "vi",
]);

/** Maps a document's `lang` ("de", "pt-BR") to its number convention. Unknown or missing is dot-decimal. */
export const conventionForLang = (lang: string | null | undefined): NumberConvention =>
  COMMA_DECIMAL_LANGS.has((lang ?? "").trim().toLowerCase().split("-")[0] ?? "") ? "comma-decimal" : "dot-decimal";

/** A maximal run of digits and separators, checked and rewritten as one number. */
const NUMBER_TOKEN_RE = /[\d.,]*\d/g;
const COMMA_DECIMAL_TOKEN_RE = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d+))?$/;

/**
 * Rewrites comma-decimal numbers ("2.962", "891,12", "1.299,00") into
 * dot-decimal form for NUMBER_RE. A dot counts as a thousands separator only
 * when every group has three digits, so "1.5" and "1,234,567" do not fit the
 * convention and null makes the cell text instead of a silent misreading.
 */
const normalizeCommaDecimal = (text: string): string | null => {
  let bad = false;
  const out = text.replace(NUMBER_TOKEN_RE, (token) => {
    if (!token.includes(".") && !token.includes(",")) return token;
    const m = COMMA_DECIMAL_TOKEN_RE.exec(token);
    if (m?.[1] === undefined) {
      bad = true;
      return token;
    }
    return m[1].replaceAll(".", "") + (m[2] === undefined ? "" : `.${m[2]}`);
  });
  return bad ? null : out;
};

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
    "(%|[x×]|[" +
    CURRENCY +
    "]|[a-zA-Zµ°/]{1,9}(?:\\s?[a-zA-Z/]{1,6})?)?" +
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
 * column means. A season total of ice time or minutes played runs past 999
 * minutes ("1544:10"), so the first part takes up to four digits.
 */
const DURATION_RE = /^(\d{1,4}):([0-5]\d)(?::([0-5]\d))?$/;

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

/**
 * Fractions written with the fraction slash (U+2044), as in "8 1⁄2" from an
 * encyclopedia's fraction template. The numerator must be smaller than the
 * denominator, so "81⁄2" with the space lost stays text instead of reading
 * as 40.5.
 */
const FRACTION_RE = /^(?:(\d+)\s+)?(\d+)\s*\u2044\s*(\d+)$/;

/** Parses one number. parseRange handles ranges. */
const parseSingle = (input: string, convention: NumberConvention): ParsedNumber | null => {
  let text = input;
  if (convention === "comma-decimal") {
    const normalized = normalizeCommaDecimal(text);
    if (normalized === null) return null;
    text = normalized;
  }
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
  const fraction = FRACTION_RE.exec(text);
  if (fraction !== null) {
    const [, whole = "0", num = "0", den = "0"] = fraction;
    if (!(Number(num) < Number(den))) return null;
    const value = Number(whole) + Number(num) / Number(den);
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
    } else if (suffix.length === 1 && CURRENCY.includes(suffix)) {
      // Trailing currency ("40 €", "1.299,00 €"), the usual order in most of Europe.
      unit = unit ?? suffix;
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
const parseRange = (text: string, convention: NumberConvention): ParsedNumber | null => {
  for (const m of text.matchAll(RANGE_SEPARATOR)) {
    if (m.index === 0) continue;
    const lo = parseSingle(text.slice(0, m.index), convention);
    const hi = parseSingle(text.slice(m.index + m[0].length), convention);
    if (lo === null || hi === null || lo.bound || hi.bound) continue;
    if (lo.unit !== null && hi.unit !== null && lo.unit !== hi.unit) continue;
    if (!(lo.value < hi.value)) continue;
    return { value: (lo.value + hi.value) / 2, unit: hi.unit ?? lo.unit, bound: false, range: [lo.value, hi.value] };
  }
  return null;
};

/** A signed change after a value, as in "740 (-16)" or "2.4% (+0.3%)". The sign is required. */
const CHANGE_RE = /^(.*\S)\s+\(\s*[+\-−±]\s*\d[\d,.]*\s*%?\s*\)$/;

/**
 * A value followed by the condition it holds under, as in "$0.10 / MTok for
 * prompts up to 100,000 tokens". The condition starts with a lowercase word
 * from a short list and then a word, so a batting line ("2 for 4") or bowling
 * figures ("3 for 45") stay text.
 */
const CONDITION_RE = /^(.*?\S)\s+(?:for|when|if|until|after|before)\s+\p{L}/u;

/**
 * A measurement followed by the same amount in another unit, as in
 * "317.7 km/h (197 mph)" or "1,021.9 km (635 mi)". Both sides must carry a
 * unit and the units must differ, so a value with a bare number ("45 (12)")
 * stays text. parseCountShare reads a count with its share ("1,234 (45%)").
 */
const CONVERSION_RE = /^(.*\S)\s*\(([^()]+)\)$/;

const isMeasureUnit = (unit: string | null): unit is string =>
  unit !== null && unit !== "%" && unit !== "x" && unit !== ":" && !CURRENCY.includes(unit) && !unit.endsWith("$");

const parseConversion = (text: string, convention: NumberConvention): ParsedNumber | null => {
  const m = CONVERSION_RE.exec(text);
  if (m?.[1] === undefined || m[2] === undefined) return null;
  const outer = parseSingle(m[1], convention);
  const inner = parseSingle(m[2].trim(), convention);
  if (outer === null || inner === null || outer.bound || inner.bound) return null;
  if (!isMeasureUnit(outer.unit) || !isMeasureUnit(inner.unit)) return null;
  if (outer.unit.toLowerCase() === inner.unit.toLowerCase()) return null;
  return outer;
};

/**
 * A count followed by its share of the whole, as in "1,234 (45.2%)" or
 * "22(13.1%)" from an analytics breakdown. The count must be a bare number
 * and the share a bare percentage from 0 to 100, so "45 (12)", "$40 (12%)",
 * and "12% (3%)" stay text. In one column every share divides by the same
 * total, so ordering by count and by share agree.
 */
const COUNT_SHARE_RE = /^(.*\S)\s*\(\s*(\d+(?:[.,]\d+)?)\s*%\s*\)$/;

const parseCountShare = (text: string, convention: NumberConvention): ParsedNumber | null => {
  const m = COUNT_SHARE_RE.exec(text);
  if (m?.[1] === undefined || m[2] === undefined) return null;
  // The share's decimal separator must follow the page's convention, so "22 (13,1%)" reads on a German page and stays text on an English one.
  const share = parseSingle(m[2], convention);
  if (share === null || share.value > 100) return null;
  const count = parseSingle(m[1], convention);
  if (count === null || count.unit !== null || count.bound || count.value < 0) return null;
  return count;
};

/** Parses one cell. Returns null for missing, non-numeric, or ambiguous text. */
export const parseNumber = (raw: string, convention: NumberConvention = "dot-decimal"): ParsedNumber | null => {
  const text = stripNoise(raw);
  // A value followed by its change: the value is the cell's number.
  const change = CHANGE_RE.exec(text);
  if (change?.[1] !== undefined) return parseNumber(change[1], convention);
  // A value with its condition: the value is the cell's number.
  const condition = CONDITION_RE.exec(text);
  if (condition?.[1] !== undefined) return parseNumber(condition[1], convention);
  // Open-ended bins: "65+", and with a magnitude, "1M+".
  const plus = /^(.*\d\s*[KMBTkmbt]?)\s*\+$/.exec(text);
  if (plus?.[1] !== undefined) {
    const n = parseSingle(plus[1], convention);
    return n === null ? null : { ...n, bound: true };
  }
  return (
    parseSingle(text, convention) ??
    parseRange(text, convention) ??
    parseConversion(text, convention) ??
    parseCountShare(text, convention)
  );
};

/** Normalizes a category label for grouping. It removes footnote markers and lowercases the text. */
export const normalizeLabel = (raw: string): string => stripNoise(raw).toLowerCase();
