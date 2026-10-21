import { test } from "node:test";
import assert from "node:assert/strict";
import { lowAllowanceNote, mergeAllowance, quotaMessage, resetTime } from "../src/ext/allowance.ts";

// 3 PM in New York on October 18 is 19:00 UTC. The next UTC midnight is 8 PM there.
process.env["TZ"] = "America/New_York";
const now = new Date("2026-10-18T19:00:00Z");

test("the reset is the next UTC midnight, shown in local time", () => {
  assert.equal(resetTime(now, "en-US"), "8:00 PM");
});

test("the lowest count reported today wins; a new day starts over", () => {
  const today = mergeAllowance(undefined, { remaining: 50, limit: 400 }, now);
  assert.deepEqual(today, { remaining: 50, limit: 400, day: "2026-10-18" });
  // A response that left the server earlier, arriving late, doesn't raise the count.
  assert.equal(mergeAllowance(today, { remaining: 52, limit: 400 }, now).remaining, 50);
  assert.equal(mergeAllowance(today, { remaining: 48, limit: 400 }, now).remaining, 48);
  const tomorrow = new Date("2026-10-19T01:00:00Z");
  assert.deepEqual(mergeAllowance(today, { remaining: 399, limit: 400 }, tomorrow), {
    remaining: 399,
    limit: 400,
    day: "2026-10-19",
  });
});

test("a note appears only when under a fifth of today's allowance is left", () => {
  const at = (remaining: number, day = "2026-10-18") => lowAllowanceNote({ remaining, limit: 400, day }, now);
  assert.equal(at(200), null);
  assert.equal(at(80), null);
  assert.equal(at(79), "About 7 pages of free use left today. Add your own key in Options for unlimited use.");
  assert.equal(at(10), "About a page of free use left today. Add your own key in Options for unlimited use.");
  assert.equal(at(0), null, "the summary reports a used-up allowance, not the note");
  assert.equal(at(10, "2026-10-17"), null, "yesterday's count no longer applies");
  assert.equal(lowAllowanceNote(undefined, now), null);
});

test("used-up messages say whose allowance it was and when it resets", () => {
  assert.equal(
    quotaMessage("quota", now, "en-US"),
    "You've used today's free allowance. It resets at 8:00 PM; add your own key in Options for unlimited use.",
  );
  assert.match(
    quotaMessage("quota_everyone", now, "en-US"),
    /^Today's free allowance is used up for everyone\. It resets at 8:00 PM;/,
  );
});
