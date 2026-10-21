import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, parseDate, parseDateColumn } from "../src/core/dates.ts";

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const DAY = 86_400_000;
const at = (raw: string) => parseDate(raw, { now: NOW });

test("calendar dates in common forms", () => {
  const feb6 = Date.UTC(2023, 1, 6);
  for (const raw of [
    "2023-02-06",
    "Feb 6, 2023",
    "February 6 2023",
    "6 February 2023",
    "6 Feb. 2023",
    "Mon, Feb 6, 2023",
    "February 6th, 2023",
    "2023/02/06",
  ]) {
    assert.deepEqual(at(raw), { time: feb6, precision: "day" }, raw);
  }
});

test("months without a day", () => {
  const dec = Date.UTC(1993, 11, 1);
  for (const raw of ["December 1993", "Dec 1993", "Dec. 1993", "1993-Dec", "Dec-1993"]) {
    assert.deepEqual(at(raw), { time: dec, precision: "month" }, raw);
  }
  assert.deepEqual(at("2026-Mar"), { time: Date.UTC(2026, 2, 1), precision: "month" });
});

test("times of day, offsets and two-digit years", () => {
  assert.deepEqual(at("2024-01-02T03:04:05Z"), { time: Date.UTC(2024, 0, 2, 3, 4, 5), precision: "minute" });
  assert.deepEqual(at("2024-01-02 03:04"), { time: Date.UTC(2024, 0, 2, 3, 4), precision: "minute" });
  assert.deepEqual(at("Sep 29, '26 19:07:16 -0400"), { time: Date.UTC(2026, 8, 29, 23, 7, 16), precision: "minute" });
  assert.deepEqual(at("Feb 6, 2023, 3:04 PM"), { time: Date.UTC(2023, 1, 6, 15, 4), precision: "minute" });
  assert.deepEqual(at("Feb 6, 2023 at 12:30 am"), { time: Date.UTC(2023, 1, 6, 0, 30), precision: "minute" });
});

test("relative times count back from now", () => {
  assert.deepEqual(at("3 days ago"), { time: NOW - 3 * DAY, precision: "relative" });
  assert.equal(at("an hour ago")?.time, NOW - 3_600_000);
  assert.equal(at("5m ago")?.time, NOW - 300_000);
  assert.equal(at("2 hrs ago")?.time, NOW - 7_200_000);
  assert.equal(at("about 1 month ago")?.time, NOW - 30.436875 * DAY);
  assert.equal(at("yesterday")?.time, NOW - DAY);
  assert.equal(at("just now")?.time, NOW);
  assert.equal(at("last year")?.time, NOW - 365.2425 * DAY);
  assert.equal(at("in 2 weeks")?.time, NOW + 14 * DAY);
});

test("not dates", () => {
  for (const raw of [
    "2019-20",
    "2010-11",
    "12-4",
    "35-10",
    "1993",
    "Sep 29",
    "7:07 pm",
    "2:59",
    "Feb 30, 2023",
    "2023-13-01",
    "3 days",
    "May",
    "Mayday 2020",
    "",
    "N/A",
  ]) {
    assert.equal(at(raw), null, raw);
  }
});

test("numeric dates need a column to tell day from month", () => {
  assert.equal(at("9/10/2026"), null);
  assert.equal(parseDate("9/10/2026", { now: NOW, order: "mdy" })?.time, Date.UTC(2026, 8, 10));
  assert.equal(parseDate("9/10/2026", { now: NOW, order: "dmy" })?.time, Date.UTC(2026, 9, 9));

  const us = parseDateColumn(["9/10/2026", "9/29/2026", "10/1/2026"], NOW);
  assert.deepEqual(us?.values, [Date.UTC(2026, 8, 10), Date.UTC(2026, 8, 29), Date.UTC(2026, 9, 1)]);
  const eu = parseDateColumn(["9/10/2026", "29/9/2026", "1/10/2026"], NOW);
  assert.deepEqual(eu?.values, [Date.UTC(2026, 9, 9), Date.UTC(2026, 8, 29), Date.UTC(2026, 9, 1)]);
  // Every day and month 12 or under: no way to tell, so no dates.
  assert.equal(parseDateColumn(["1/2/2026", "3/4/2026", "5/6/2026"], NOW), null);
  // Dots are day first.
  assert.equal(parseDateColumn(["1.2.2026", "3.4.2026", "5.6.2026"], NOW)?.values[0], Date.UTC(2026, 1, 1));
});

test("a column of dates: missing cells, units, and the share needed", () => {
  const col = parseDateColumn(["Feb 6, 2023", "—", "Mar 1, 2023", "Jan 2, 2024"], NOW);
  assert.deepEqual(col, {
    values: [Date.UTC(2023, 1, 6), null, Date.UTC(2023, 2, 1), Date.UTC(2024, 0, 2)],
    unit: "date",
  });
  assert.equal(parseDateColumn(["December 1993", "April 1997", "June 2001"], NOW)?.unit, "month");
  assert.equal(parseDateColumn(["2024-01-02T03:04Z", "2024-01-03T03:04Z", "2024-01-04T03:04Z"], NOW)?.unit, "datetime");
  assert.equal(parseDateColumn(["2 hours ago", "yesterday", "Mar 3, 2024"], NOW)?.unit, "ago");
  assert.equal(parseDateColumn(["Feb 6, 2023", "soon", "later", "Jan 2, 2024"], NOW), null);
  assert.equal(parseDateColumn(["Feb 6, 2023", "Feb 6, 2023", "Feb 6, 2023"], NOW), null);
});

test("legend text in the column's own precision", () => {
  assert.equal(formatDate(Date.UTC(2023, 1, 6), "date", NOW), "Feb 6, 2023");
  assert.equal(formatDate(Date.UTC(1993, 11, 1), "month", NOW), "Dec 1993");
  assert.equal(formatDate(Date.UTC(2024, 0, 2, 15, 4), "datetime", NOW), "Jan 2, 2024, 3:04 PM");
  assert.equal(formatDate(NOW - 3 * DAY, "ago", NOW), "3 days ago");
  assert.equal(formatDate(NOW - 125_000, "ago", NOW), "2 minutes ago");
  assert.equal(formatDate(NOW - 400 * DAY, "ago", NOW), "last year");
});

test("dates without a year take one from their column", () => {
  assert.deepEqual(parseDate("Feb 6", { now: NOW, year: 2000 }), {
    time: Date.UTC(2000, 1, 6),
    precision: "day",
    yearless: true,
  });
  assert.equal(parseDate("6 February", { now: NOW, year: 2000 })?.time, Date.UTC(2000, 1, 6));

  // Unsorted: one year, a leap year.
  const quakes = parseDateColumn(
    ["February 6", "February 6", "September 8", "May 19", "December 2", "February 29"],
    NOW,
  );
  assert.equal(quakes?.unit, "monthday");
  assert.deepEqual(
    quakes?.values,
    [6, 6, 8, 19, 2, 29].map((d, i) => Date.UTC(2000, [1, 1, 8, 4, 11, 1][i]!, d)),
  );
  assert.equal(formatDate(Date.UTC(2000, 1, 6), "monthday", NOW), "Feb 6");

  // Beside dates with years, a date without one is this year.
  assert.equal(parseDateColumn(["Mar 3", "Jan 2, 2024", "Feb 5, 2023"], NOW)?.values[0], Date.UTC(2026, 2, 3));
});

test("a sorted column of dates without years crosses New Year once", () => {
  const season = parseDateColumn(["Sep 8", "Oct 12", "Dec 30", "Jan 5", "Feb 2"], NOW)!.values;
  assert.ok(season[3]! > season[2]!, "Jan 5 is after Dec 30");
  assert.ok(season.every((v, i) => i === 0 || v! > season[i - 1]!));

  const newestFirst = parseDateColumn(["Feb 2", "Jan 5", "Dec 30", "Oct 12"], NOW)!.values;
  assert.ok(newestFirst.every((v, i) => i === 0 || v! < newestFirst[i - 1]!));

  // One step down, but not across New Year (May to February): one year.
  const unsorted = parseDateColumn(["Mar 3", "May 1", "Feb 2"], NOW)!.values;
  assert.ok(unsorted[2]! < unsorted[0]!);
});

test("notes in parentheses and ranges of days", () => {
  assert.equal(at("Jan 15, 1967 (1966 AFL/1966 NFL)")?.time, Date.UTC(1967, 0, 15));
  assert.equal(at("Feb 2030 (2029)")?.time, Date.UTC(2030, 1, 1));
  const mid = (a: number, b: number) => (a + b) / 2;
  assert.deepEqual(at("July 16–22, 2021"), {
    time: mid(Date.UTC(2021, 6, 16), Date.UTC(2021, 6, 22)),
    precision: "day",
  });
  assert.equal(at("July 16-22, 2021")?.time, mid(Date.UTC(2021, 6, 16), Date.UTC(2021, 6, 22)));
  assert.equal(at("16–22 July 2021")?.time, mid(Date.UTC(2021, 6, 16), Date.UTC(2021, 6, 22)));
  assert.equal(at("July 30 – August 2, 2021")?.time, mid(Date.UTC(2021, 6, 30), Date.UTC(2021, 7, 2)));
  assert.equal(at("Dec 28, 2020 to Jan 3, 2021")?.time, mid(Date.UTC(2020, 11, 28), Date.UTC(2021, 0, 3)));
  assert.equal(at("2021-07-16 – 2021-07-22")?.time, mid(Date.UTC(2021, 6, 16), Date.UTC(2021, 6, 22)));
  // In a column, where dates without a year are allowed, the start still takes the end's year.
  assert.equal(
    parseDate("July 16–22, 2021", { now: NOW, year: 2000 })?.time,
    mid(Date.UTC(2021, 6, 16), Date.UTC(2021, 6, 22)),
  );
  assert.deepEqual(parseDateColumn(["April 16, 2021", "July 16–22, 2021", "None", "May 1, 2022"], NOW)?.values, [
    Date.UTC(2021, 3, 16),
    mid(Date.UTC(2021, 6, 16), Date.UTC(2021, 6, 22)),
    null,
    Date.UTC(2022, 4, 1),
  ]);
  // Backwards, or not two dates.
  for (const raw of ["July 22–16, 2021", "No Pre-release Scheduled", "1997–98", "3 days ago – 2 days ago"])
    assert.equal(at(raw), null, raw);
});

test("words that name Object.prototype members are not dates", () => {
  for (const raw of ["constructor", "__proto__", "Constructor"]) assert.equal(at(raw), null, raw);
});

test("cells far longer than any date return null", () => {
  for (const raw of [
    "-".repeat(8000) + "x",
    "Jan 1 - ".repeat(1000),
    "1 to ".repeat(1600),
    `Feb 6, 2023 (${"a ".repeat(4000)})`,
  ]) {
    assert.equal(at(raw), null, raw.slice(0, 20));
  }
});

test("a date with a long trailing note still parses", () => {
  assert.equal(at(`Jan 15, 1967 (${"note ".repeat(30)})`)?.time, Date.UTC(1967, 0, 15));
  assert.equal(at("Jan 15, 1967   (1966 AFL/1966 NFL)")?.time, Date.UTC(1967, 0, 15));
});
