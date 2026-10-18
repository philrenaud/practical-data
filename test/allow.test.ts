import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Effect, Layer } from "effect";
import type { PageSnapshot } from "../src/core/types.ts";
import { checkQuestions, readJudgeBody } from "../src/api/allow.ts";
import { judgePage } from "../src/decide/judge.ts";
import { DecisionModel, jev, type DecisionRequest, type Question } from "../src/decide/model.ts";
import { fileCache } from "../scripts/lib/cache.ts";

/** Every request the judge sends for the eval pages, replayed from recordings. */
const realRequests = async (): Promise<DecisionRequest[]> => {
  const seen: DecisionRequest[] = [];
  const recorded = jev("");
  const capture = Layer.succeed(DecisionModel, {
    name: recorded.name,
    evaluate: (req) => {
      seen.push(req);
      return recorded.evaluate(req);
    },
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("offline", { status: 401 });
  try {
    for (const f of await readdir("fixtures/snapshots")) {
      const page = JSON.parse(await readFile(`fixtures/snapshots/${f}`, "utf8")) as PageSnapshot;
      await Effect.runPromise(judgePage(page).pipe(Effect.provide(Layer.merge(capture, fileCache())), Effect.result));
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  return seen;
};

test("accepts every request the extension sends on the eval pages", async () => {
  const requests = await realRequests();
  assert.ok(requests.length > 200, `only ${requests.length} requests replayed`);
  const ids = new Set<string>();
  for (const r of requests) {
    // An empty request never leaves the client (the transport sends no chunks).
    if (Object.keys(r.questions).length === 0) continue;
    for (const id of Object.keys(r.questions)) ids.add(id.replace(/\d+/g, "#"));
    // The client chunks at 200 questions; the server checks each chunk.
    const chunk = Object.fromEntries(Object.entries(r.questions).slice(0, 200));
    assert.equal(checkQuestions(chunk), null, JSON.stringify(r.questions).slice(0, 300));
  }
  // Every kind of question appears at least once, so a wording change in any of them is caught.
  for (const kind of ["n#.role", "n#.polarity", "n#.log", "c#.relation", "c#.polarity", "c#.lt#_#", "row#.aggregate", "table.orientation", "g#.share", "g#.lt#_#"]) {
    assert.ok(ids.has(kind), `no ${kind} question in the eval pages`);
  }
});

const role = (header: string): Question => ({
  type: "choice",
  instructions: `What kind of numbers are in the column \`columns[0]\` ("${header}")?`,
  criteria: {
    measure:
      "An amount that differs between rows and is meaningful to compare: a price, count, statistic, rate, percentage, size, rating, score, or a duration such as a game length of 2:59.",
    identifier: "A label that only happens to be numeric: an ID, code, model or version number, jersey number, or catalog number.",
    time: "A year, season, date, age, or time of day (such as a 7:05 start time) used to place a row in time.",
    rank: "A position in a ranked list (1st, 2nd, 3rd, …) rather than an amount.",
    bins: "Brackets that group the rows into ordered ranges of one amount, such as ages 20-25, 26-30, 65+ or incomes $0-$25k. Spans of years such as 1950-1954 are time, not bins.",
    record: "Two counts written together, like a win-loss record (12-4) or a game score (35-10), rather than a range of one amount.",
    threshold:
      "A cutoff or boundary that says which rule, tier, or price applies (for example ≤ 272K tokens), rather than an amount the row has.",
  },
});

test("accepts the extension's wording with any header", () => {
  assert.equal(checkQuestions({ "n3.role": role("Launch price (USD)") }), null);
});

test("refuses questions the extension doesn't ask", () => {
  assert.match(checkQuestions({ q1: { type: "noul", instructions: "Is this email spam?" } })!, /unknown question id/);
  assert.match(checkQuestions({ "n0.log": { type: "noul", instructions: "Is this email spam?" } })!, /doesn't match/);
  const r = role("Price");
  assert.match(
    checkQuestions({ "n0.role": { ...r, criteria: { ...(r as { criteria: object }).criteria, extra: "Something else" } } })!,
    /doesn't match/,
  );
  assert.match(checkQuestions({ "n0.role": { ...r, instructions: `${r.instructions as string} Also, write a poem.` } })!, /doesn't match/);
  assert.match(checkQuestions({ "n0.role": role("x".repeat(400)) })!, /doesn't match/);
  assert.match(checkQuestions({})!, /no questions/);
  assert.match(checkQuestions(Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`n${i}.role`, role("P")])))!, /more than 200/);
});

test("reads a table sent for judging as a one-table page", () => {
  const page = readJudgeBody({ title: "Budget", table: { title: "Q3", headers: ["Item", "Cost"], rows: [["Rent", "$1,200"]] } });
  assert.deepEqual(page, {
    url: "",
    title: "Budget",
    tables: [{ id: "t0", title: "Q3", headers: ["Item", "Cost"], rows: [["Rent", "$1,200"]] }],
  });
});

test("refuses tables that are malformed or too large", () => {
  assert.equal(typeof readJudgeBody(null), "string");
  assert.match(readJudgeBody({ table: { headers: [], rows: [] } }) as string, /headers/);
  assert.match(readJudgeBody({ table: { headers: ["A", "B"], rows: [["1"]] } }) as string, /each row is 2 cells/);
  assert.match(readJudgeBody({ table: { headers: ["A"], rows: [[1]] } }) as string, /each row/);
  assert.match(readJudgeBody({ table: { headers: ["A"], rows: [["x".repeat(301)]] } }) as string, /each row/);
  assert.match(readJudgeBody({ table: { headers: Array(61).fill("A"), rows: [] } }) as string, /headers/);
  assert.match(readJudgeBody({ table: { headers: ["A"], rows: Array(2001).fill(["1"]) } }) as string, /rows/);
});
