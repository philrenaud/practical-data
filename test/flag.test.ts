import { test } from "node:test";
import assert from "node:assert/strict";
import { readBody } from "../src/api/allow.ts";
import { FLAG_LIMITS, fileUserFlag, readFlag, userFlagIssue, type FlagReport } from "../src/api/flag.ts";

const report: FlagReport = {
  url: "https://tables.example/widgets/compare",
  pageTitle: "Comparing invented widgets",
  pageLang: "en",
  kind: "shaded",
  table: {
    title: "Widget throughput",
    headers: ["Widget", "Throughput", "Price"],
    rows: [
      ["Anvil", "120/s", "$9"],
      ["Bobbin", "80/s", "$5"],
    ],
  },
  note: "The Price column is shaded backwards.",
  build: "1.2.0 (0000000, 2026-11-03 00:00)",
};

/** The reason `readFlag` refuses the report with `patch` applied, or null when it accepts it. */
const why = (patch: Record<string, unknown>): string | null => {
  const read = readFlag({ ...structuredClone(report), ...patch });
  return "error" in read ? read.message : null;
};

test("accepts a full report unchanged", () => {
  assert.deepEqual(readFlag(structuredClone(report)), report);
});

test("accepts a report without the optional url, language, and note", () => {
  const { url: _u, pageLang: _l, note: _n, ...rest } = report;
  const read = readFlag(structuredClone(rest));
  assert.deepEqual(read, rest);
  assert.equal("url" in read, false);
});

test("refuses a report outside the shape, with a terse reason", () => {
  assert.deepEqual(readFlag("flag"), { error: "flag", message: "not a JSON object" });
  assert.match(why({ kind: "wrong" }) ?? "", /kind must be/);
  assert.match(why({ extra: true }) ?? "", /unknown field "extra"/);
  assert.match(why({ pageTitle: "" }) ?? "", /pageTitle/);
  assert.match(why({ pageTitle: "t".repeat(301) }) ?? "", /pageTitle/);
  assert.match(why({ build: 12 }) ?? "", /build/);
  assert.match(why({ url: "ftp://tables.example/x" }) ?? "", /url must be an http/);
  assert.match(why({ url: `https://tables.example/${"x".repeat(2000)}` }) ?? "", /url must be an http/);
  assert.match(why({ pageLang: "l".repeat(36) }) ?? "", /pageLang/);
  assert.match(why({ note: "n".repeat(501) }) ?? "", /note/);
});

test("refuses a table outside its caps", () => {
  const t = report.table;
  assert.match(why({ table: { ...t, extra: 1 } }) ?? "", /title, headers, and rows only/);
  assert.match(why({ table: { ...t, title: "t".repeat(201) } }) ?? "", /table\.title/);
  assert.match(why({ table: { ...t, headers: [] } }) ?? "", /table\.headers/);
  assert.match(why({ table: { ...t, headers: Array(31).fill("h") } }) ?? "", /table\.headers/);
  assert.match(why({ table: { ...t, headers: ["a", "b", "c".repeat(201)] } }) ?? "", /table\.headers/);
  const row = (c: string) => [c, c, c];
  assert.match(why({ table: { ...t, rows: Array(6).fill(row("x")) } }) ?? "", /table\.rows/);
  assert.match(why({ table: { ...t, rows: [row("x".repeat(201))] } }) ?? "", /table\.rows/);
  assert.match(why({ table: { ...t, rows: [["too", "narrow"]] } }) ?? "", /table\.rows/);
  assert.equal(why({ table: { ...t, rows: [] } }), null);
});

test("reads a flag body only up to its own byte limit", async () => {
  const post = (text: string) => new Request("https://api.test/v1/flag", { method: "POST", body: text });
  assert.deepEqual(await readBody(post(JSON.stringify({ note: "n" })), FLAG_LIMITS.bodyBytes), { note: "n" });
  await assert.rejects(readBody(post(JSON.stringify("x".repeat(40_000))), FLAG_LIMITS.bodyBytes), RangeError);
});

test("a user flag's issue names the host and shows the sample rows", () => {
  const { title, body } = userFlagIssue(report);
  assert.equal(title, "tables.example: shaded Widget throughput");
  assert.match(body, /\*\*Shaded\*\* on tables\.example · build 1\.2\.0 .* · from a store user/);
  assert.match(body, /https:\/\/tables\.example\/widgets\/compare/);
  assert.match(body, /3 columns, 2 sample rows\./);
  assert.match(body, /\| Widget \| Throughput \| Price \|/);
  assert.match(body, /\| Anvil \| 120\/s \| \$9 \|/);
  assert.match(body, /> The Price column is shaded backwards\./);
});

test("a report without a URL is titled (no url) and the body says the user left it out", () => {
  const { url: _u, note: _n, ...rest } = report;
  const { title, body } = userFlagIssue({ ...rest, kind: "unshaded", table: { ...rest.table, title: null } });
  assert.equal(title, "(no url): unshaded Widget, Throughput, Price");
  assert.match(body, /No page URL\. The user left it out\./);
  assert.doesNotMatch(body, /tables\.example/);
  assert.doesNotMatch(body, /^> /m);
});

test("filing opens the issue with the flag and user labels", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ number: 12 }), { status: 201 });
  }) as typeof fetch;
  assert.equal(await fileUserFlag(report, "tok", "o/r", fake), 12);
  assert.equal(calls[0]!.url, "https://api.github.com/repos/o/r/issues");
  const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
  assert.deepEqual(body["labels"], ["flag", "user"]);
  assert.equal(body["title"], "tables.example: shaded Widget throughput");
  // GitHub refuses any request without a User-Agent with a 403.
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers["User-Agent"], "practical-data-api");
});

test("a GitHub error stops the flag without its response body", async () => {
  const fake = (async () => new Response("the provider's words", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(fileUserFlag(report, "t", "o/r", fake), (e: Error) => {
    assert.match(e.message, /401/);
    assert.doesNotMatch(e.message, /provider's words/);
    return true;
  });
});
