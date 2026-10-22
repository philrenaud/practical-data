import { test } from "node:test";
import assert from "node:assert/strict";
import { fileFlag, flagId, flagIssue, type FlagContext } from "../src/ext/flags.ts";

const inbox: FlagContext = {
  id: "20261022-141500-0a1b",
  flaggedAt: "2026-10-22T14:15:00.000Z",
  build: "1.1.0 (a67ac39, 2026-10-22 03:40)",
  provider: "hosted",
  kind: "shaded",
  url: "https://mail.google.com/mail/u/0/#inbox",
  pageTitle: "Inbox",
  status: "done",
  table: {
    id: "t0",
    title: null,
    headers: ["", "Sender", "Subject", "Date"],
    rows: [
      ["", "Jiffy", "Take $25 | off", "Oct 21"],
      ["", "Eli", "The assignment", "Oct 17"],
    ],
  },
  judgment: {
    id: "t0",
    orientation: "columns",
    rowsScore: null,
    encodings: [
      {
        kind: "quantitative",
        col: 3,
        header: "Date",
        polarity: "higher_is_better",
        transform: "linear",
        unit: null,
        domain: [20365, 20382],
        values: [20382, 20378],
        group: null,
        evidence: {
          comparable: 0.91,
          polarity: { higher_is_better: 0.7, lower_is_better: 0.1, neutral: 0.2 },
          log: null,
          orderConfidence: null,
        },
      },
    ],
    skipped: [{ col: 2, header: "Subject", reason: "text", comparable: 0.02 }],
    aggregateRows: [],
  },
  model: "jev-latest",
  html: "<table></table>",
  htmlTruncated: false,
  viewport: { width: 1280, height: 800, dpr: 2 },
};

test("a flag's issue names the host and lists the judged columns", () => {
  const { title, body } = flagIssue(inbox, "https://github.com/o/r/blob/main/flags/x", true);
  assert.equal(title, "mail.google.com: shaded Sender, Subject, Date");
  assert.match(body, /\*\*Shaded\*\* on mail\.google\.com · hosted \(jev-latest\)/);
  assert.match(body, /\| Date \| \*\*quantitative, higher is better, P\(comparable\) 0\.91\*\* \|/);
  assert.match(body, /\| Subject \| skipped: text \|/);
  assert.match(body, /!\[screenshot\]\(https:\/\/github\.com\/o\/r\/blob\/main\/flags\/x\/screenshot\.png\?raw=true\)/);
  assert.doesNotMatch(body, /\| Sender \|/);
});

test("a skipped table without a screenshot says so and has no image", () => {
  const { title, body } = flagIssue({ ...inbox, kind: "unshaded", table: null, judgment: null }, "u", false);
  assert.equal(title, "mail.google.com: unshaded a skipped table");
  assert.match(body, /extractor skips this table/);
  assert.doesNotMatch(body, /screenshot/);
});

test("flag ids sort by time", () => {
  assert.equal(
    flagId(new Date("2026-10-22T14:15:09.123Z"), () => 0.5),
    "20261022-141509-8000",
  );
});

test("filing writes the context and screenshot, then opens the issue", async () => {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method!, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ number: 7 }), { status: 201 });
  }) as typeof fetch;
  assert.equal(await fileFlag(inbox, "iVBOR", "tok", "o/r", fake), 7);
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      "PUT https://api.github.com/repos/o/r/contents/flags/20261022-141500-0a1b/context.json",
      "PUT https://api.github.com/repos/o/r/contents/flags/20261022-141500-0a1b/screenshot.png",
      "POST https://api.github.com/repos/o/r/issues",
    ],
  );
  const context = JSON.parse(Buffer.from(String(calls[0]!.body["content"]), "base64").toString("utf8"));
  assert.equal(context.url, inbox.url);
  assert.deepEqual(calls[2]!.body["labels"], ["flag"]);
});

test("a GitHub error stops the flag", async () => {
  const fake = (async () => new Response("Bad credentials", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(fileFlag(inbox, null, "bad", "o/r", fake), /401 Bad credentials/);
});
