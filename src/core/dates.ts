/**
 * Cell text → a point in time, in milliseconds since the epoch (UTC).
 *
 * Calendar dates ("Feb 6, 2023", "2023-02-06", "December 1993") and relative
 * times ("3 days ago", "yesterday") both become instants, so a column shades
 * from earliest to latest. Like parse.ts, this is conservative: a year alone
 * or a season ("2010-11") returns null. A month and day without a year
 * ("Feb 6") needs a year from its column (parseDateColumn).
 *
 * Times without an offset are read as UTC. Within a column every cell is read
 * the same way, which is all a scale needs.
 */
import { isMissing, stripNoise } from "./parse.ts";

/** How finely a cell names its instant. "relative" is counted back from now. */
export type DatePrecision = "month" | "day" | "minute" | "relative";

export interface ParsedDate {
  readonly time: number;
  readonly precision: DatePrecision;
  /** Written without a year ("Feb 6"); `time` is in `DateOptions.year`. */
  readonly yearless?: true;
}

/** The legend format of a date column: the coarsest form that shows every value. */
export type DateUnit = "month" | "date" | "monthday" | "datetime" | "ago";

export const DATE_UNITS: readonly DateUnit[] = ["month", "date", "monthday", "datetime", "ago"];
export const isDateUnit = (unit: string | null): unit is DateUnit => DATE_UNITS.includes(unit as DateUnit);

/** Day and month order for numeric dates ("9/10/2026"). */
export type DayOrder = "mdy" | "dmy";

export interface DateOptions {
  /** The instant that relative times count back from. */
  readonly now: number;
  /** Without an order, a numeric date with both parts 12 or under is ambiguous and returns null. */
  readonly order?: DayOrder;
  /** The year of dates written without one ("Feb 6"). Without it, they return null. */
  readonly year?: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Mean Gregorian lengths: "1 month ago" is a span, not a calendar step. */
const YEAR = 365.2425 * DAY;
const MONTH_SPAN = YEAR / 12;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Sept", "Feb.", "february" → 1-based month; null for anything else ("Mayday"). */
const monthOf = (word: string): number | null => {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(w) || (w === "sept" && m === "september"));
  return i === -1 ? null : i + 1;
};

/** UTC instant, or null when the parts name no real day (Feb 30). */
const utc = (y: number, m: number, d: number, h = 0, min = 0, s = 0): number | null => {
  const t = Date.UTC(y, m - 1, d, h, min, s);
  const date = new Date(t);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? t : null;
};

/** "'26" and "26" → 2026; "93" → 1993. */
const fullYear = (raw: string): number => {
  const digits = raw.replace(/^'/, "");
  if (digits.length === 4) return Number(digits);
  const n = Number(digits);
  return n <= 50 ? 2000 + n : 1900 + n;
};

/** "-0400", "+05:30", "Z", "UTC" → minutes east of UTC. */
const offsetMinutes = (raw: string | undefined): number => {
  if (raw === undefined || /^(z|utc|gmt)$/i.test(raw)) return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(raw);
  return m === null ? 0 : (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
};

const MONTH_WORD = "[a-z]{3,9}\\.?";
const YEAR_WORD = "\\d{4}|'\\d{2}";

/** Date forms with a month name. Groups are named so each form reads the same way. */
const NAMED: readonly RegExp[] = [
  new RegExp(`^(?<month>${MONTH_WORD})\\s+(?<day>\\d{1,2})(?:st|nd|rd|th)?,?\\s+(?<year>${YEAR_WORD})$`), // Feb 6, 2023
  new RegExp(`^(?<day>\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?<month>${MONTH_WORD}),?\\s+(?<year>${YEAR_WORD})$`), // 6 February 2023
  new RegExp(`^(?<month>${MONTH_WORD}),?[\\s-](?<year>\\d{4})$`), // December 1993, Dec-1993
  new RegExp(`^(?<year>\\d{4})[\\s-](?<month>${MONTH_WORD})$`), // 2026-Mar
  new RegExp(`^(?<month>${MONTH_WORD})\\s+(?<day>\\d{1,2})(?:st|nd|rd|th)?$`), // Feb 6
  new RegExp(`^(?<day>\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?<month>${MONTH_WORD})$`), // 6 February
];

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[t\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(z|[+-]\d{2}:?\d{2})?$/;
const YMD = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/;
/** Day and month in either order: slashes or dots with any year, dashes only with a four-digit year. */
const NUMERIC = /^(\d{1,2})([/.])(\d{1,2})\2(\d{2}|\d{4})$|^(\d{1,2})-(\d{1,2})-(\d{4})$/;
/** A trailing clock time: ", 3:04 PM", " at 19:07:16 -0400". */
const TIME = /(?:,\s*|\s+at\s+|\s+)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?:\s*(z|utc|gmt|[+-]\d{2}:?\d{2}))?$/;
const WEEKDAY = /^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/;

const UNIT_SPAN: readonly (readonly [RegExp, number])[] = [
  [/^(?:s|secs?|seconds?)$/, SECOND],
  [/^(?:m|mins?|minutes?)$/, MINUTE],
  [/^(?:h|hrs?|hours?)$/, HOUR],
  [/^(?:d|days?)$/, DAY],
  [/^(?:w|wks?|weeks?)$/, 7 * DAY],
  [/^(?:mo|mos|months?)$/, MONTH_SPAN],
  [/^(?:y|yrs?|years?)$/, YEAR],
];
const spanOf = (unit: string): number | null => UNIT_SPAN.find(([re]) => re.test(unit))?.[1] ?? null;
const countOf = (raw: string): number => (/^(an?|one)$/.test(raw) ? 1 : /^(a\s+)?few$/.test(raw) ? 3 : Number(raw));

const RELATIVE_WORDS: Readonly<Record<string, number>> = {
  now: 0, "just now": 0, "right now": 0, "a moment ago": 0, "moments ago": 0, "seconds ago": 0, "a few seconds ago": 0,
  today: 0, yesterday: -DAY, tomorrow: DAY,
};
const AGO = /^(?:about|around|almost|over|nearly|~)?\s*(\d+|an?|one|(?:a\s+)?few)\s*([a-z]+?)\s+ago$/;
const IN = /^in\s+(?:about\s+)?(\d+|an?|one|(?:a\s+)?few)\s*([a-z]+)$/;
const LAST = /^last\s+(week|month|year)$/;

const relative = (t: string, now: number): number | null => {
  if (t in RELATIVE_WORDS) return now + RELATIVE_WORDS[t]!;
  const ago = AGO.exec(t) ?? IN.exec(t);
  if (ago !== null) {
    const span = spanOf(ago[2]!);
    if (span === null) return null;
    return now + (t.startsWith("in ") ? 1 : -1) * countOf(ago[1]!) * span;
  }
  const last = LAST.exec(t);
  return last === null ? null : now - spanOf(last[1]!)!;
};

/** One cell. Returns null for anything that is not clearly one instant. */
export const parseDate = (raw: string, options: DateOptions): ParsedDate | null => {
  const t = stripNoise(raw).toLowerCase();
  if (t === "") return null;

  const rel = relative(t, options.now);
  if (rel !== null) return { time: rel, precision: "relative" };

  const iso = ISO.exec(t);
  if (iso !== null) {
    const [, y, m, d, h, min, s, zone] = iso;
    const base = utc(Number(y), Number(m), Number(d), Number(h ?? 0), Number(min ?? 0), Number(s ?? 0));
    if (base === null) return null;
    return { time: base - offsetMinutes(zone) * MINUTE, precision: h === undefined ? "day" : "minute" };
  }

  // Split off a weekday and a clock time; what is left is the date.
  let rest = t.replace(WEEKDAY, "");
  let clock: { h: number; min: number; s: number; zone: string | undefined } | null = null;
  const time = TIME.exec(rest);
  if (time !== null) {
    const [, hh, mm, ss, meridiem, zone] = time;
    let h = Number(hh);
    if (meridiem !== undefined) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (meridiem.startsWith("p") ? 12 : 0);
    }
    if (h > 23) return null;
    clock = { h, min: Number(mm), s: Number(ss ?? 0), zone };
    rest = rest.slice(0, time.index).trim();
  }

  const day = ((): { y: number; m: number; d: number; precision: DatePrecision; yearless?: true } | null => {
    for (const re of NAMED) {
      const g = re.exec(rest)?.groups;
      if (g === undefined) continue;
      const m = monthOf(g.month!);
      if (m === null) return null;
      if (g.year === undefined) {
        return options.year === undefined ? null : { y: options.year, m, d: Number(g.day), precision: "day", yearless: true };
      }
      return g.day === undefined
        ? { y: fullYear(g.year!), m, d: 1, precision: "month" }
        : { y: fullYear(g.year!), m, d: Number(g.day), precision: "day" };
    }
    const ymd = YMD.exec(rest);
    if (ymd !== null) return { y: Number(ymd[1]), m: Number(ymd[2]), d: Number(ymd[3]), precision: "day" };
    const num = NUMERIC.exec(rest);
    if (num === null) return null;
    const [a, b, y] = num[1] === undefined ? [num[5]!, num[6]!, num[7]!] : [num[1], num[3]!, num[4]!];
    const order = options.order ?? (Number(a) > 12 ? "dmy" : Number(b) > 12 ? "mdy" : null);
    if (order === null) return null;
    const [m, d] = order === "mdy" ? [a, b] : [b, a];
    return { y: fullYear(y), m: Number(m), d: Number(d), precision: "day" };
  })();
  if (day === null) return null;
  // A clock time on a month ("Dec 1993 3:04") is not a form anyone writes.
  if (clock !== null && day.precision === "month") return null;

  const base = utc(day.y, day.m, day.d, clock?.h ?? 0, clock?.min ?? 0, clock?.s ?? 0);
  if (base === null) return null;
  const parsed: ParsedDate =
    clock === null ? { time: base, precision: day.precision } : { time: base - offsetMinutes(clock.zone) * MINUTE, precision: "minute" };
  return day.yearless ? { ...parsed, yearless: true } : parsed;
};

/** The year of a column of dates without years: a leap year, so "Feb 29" is a date. */
const LEAP_YEAR = 2000;

const monthAt = (t: number) => new Date(t).getUTCMonth() + 1;
/** A step across New Year: from September or later to April or earlier. */
const crossesNewYear = (from: number, to: number) => monthAt(from) >= 9 && monthAt(to) <= 4;

/**
 * Dates without years, in a column sorted by date that crosses New Year once
 * (Sep 8 … Dec 30, Jan 5): the dates after the step are in the next year. In
 * a column sorted newest first, the dates before the step are. Any other
 * column keeps one year, since nothing in it tells where a year ends; so does
 * one that would then span a year or more.
 */
const unwrapYear = (
  cells: readonly string[],
  parsed: readonly (ParsedDate | null)[],
  parseIn: (year: number) => (c: string) => ParsedDate | null,
): (ParsedDate | null)[] => {
  const rows = parsed.flatMap((p, i) => (p === null ? [] : [{ i, t: p.time }]));
  const steps = rows.slice(1).map((r, k) => ({ from: rows[k]!, to: r }));
  const down = steps.filter((s) => s.to.t < s.from.t);
  const up = steps.filter((s) => s.to.t > s.from.t);
  const forward = down.length === 1 && crossesNewYear(down[0]!.from.t, down[0]!.to.t) ? down[0]!.to.i : null;
  const backward = up.length === 1 && crossesNewYear(up[0]!.to.t, up[0]!.from.t) ? up[0]!.to.i : null;
  if (forward === null && backward === null) return [...parsed];
  const [first, next] = [parseIn(LEAP_YEAR - 1), parseIn(LEAP_YEAR)];
  const shifted = cells.map((c, i) => (forward !== null ? (i >= forward ? next(c) : first(c)) : i < backward! ? next(c) : first(c)));
  // A season is under a year long. A wider span means the column was not sorted after all.
  const times = shifted.flatMap((p) => (p === null ? [] : [p.time]));
  return Math.max(...times) - Math.min(...times) < 365 * DAY ? shifted : [...parsed];
};

/** Share of filled cells that must parse, as for numbers (profile.ts). */
const DATE_SHARE = 0.8;
const MIN_DATES = 3;

/**
 * Day order for a column's numeric dates, from the cells that settle it: a
 * first part over 12 is a day, a second part over 12 is a day. Dots are day
 * first by convention. Null when nothing settles it, or the cells disagree.
 */
const columnOrder = (cells: readonly string[]): DayOrder | null => {
  let dmy = false;
  let mdy = false;
  let dots = false;
  for (const c of cells) {
    const m = NUMERIC.exec(stripNoise(c).replace(TIME, "").trim());
    if (m === null) continue;
    const [a, b] = m[1] === undefined ? [m[5]!, m[6]!] : [m[1], m[3]!];
    if (m[2] === ".") dots = true;
    if (Number(a) > 12) dmy = true;
    if (Number(b) > 12) mdy = true;
  }
  if (dmy && mdy) return null;
  return dmy ? "dmy" : mdy ? "mdy" : dots ? "dmy" : null;
};

/**
 * A whole column, when it is a column of dates: one instant per row (null for
 * missing cells) and the unit its legend uses. Null when too few cells parse,
 * or every date is the same.
 */
export const parseDateColumn = (cells: readonly string[], now: number): { values: (number | null)[]; unit: DateUnit } | null => {
  const order = columnOrder(cells) ?? undefined;
  const parseIn = (year: number) => (c: string) => (isMissing(c) ? null : parseDate(c, { now, year, ...(order === undefined ? {} : { order }) }));
  let parsed = cells.map(parseIn(LEAP_YEAR));
  const filled = cells.filter((c) => !isMissing(c)).length;
  let dates = parsed.filter((p) => p !== null);
  if (dates.length < MIN_DATES || dates.length / filled < DATE_SHARE) return null;
  const yearless = dates.every((d) => d.yearless);
  if (yearless) parsed = unwrapYear(cells, parsed, parseIn);
  // Beside dates with years, "Mar 3" means this year, as on GitHub.
  else if (dates.some((d) => d.yearless)) parsed = cells.map(parseIn(new Date(now).getUTCFullYear()));
  dates = parsed.filter((p) => p !== null);
  if (new Set(dates.map((d) => d.time)).size < 2) return null;
  const has = (p: DatePrecision) => dates.some((d) => d.precision === p);
  const unit: DateUnit = has("relative")
    ? "ago"
    : dates.every((d) => d.precision === "month")
      ? "month"
      : has("minute")
        ? "datetime"
        : yearless
          ? "monthday"
          : "date";
  return { values: parsed.map((p) => p?.time ?? null), unit };
};

const FORMATS: Readonly<Record<Exclude<DateUnit, "ago">, Intl.DateTimeFormatOptions>> = {
  month: { month: "short", year: "numeric", timeZone: "UTC" },
  date: { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  monthday: { month: "short", day: "numeric", timeZone: "UTC" },
  datetime: { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" },
};

const RELATIVE_STEPS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["year", YEAR], ["month", MONTH_SPAN], ["week", 7 * DAY], ["day", DAY], ["hour", HOUR], ["minute", MINUTE],
];

/** A date for a legend: "Feb 6, 2023", "Dec 1993", or "3 days ago" against `now`. */
export const formatDate = (time: number, unit: DateUnit, now: number): string => {
  if (unit !== "ago") return new Intl.DateTimeFormat("en-US", FORMATS[unit]).format(time).replace(" at ", ", ");
  const delta = time - now;
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  for (const [unitName, span] of RELATIVE_STEPS) {
    if (Math.abs(delta) >= span) return rtf.format(Math.round(delta / span), unitName);
  }
  return "just now";
};
