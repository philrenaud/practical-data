/**
 * Runs the free endpoint locally with `wrangler dev`, against a stand-in for
 * the TypeSafe API that replays fixtures/recordings. It checks the following:
 *
 * - A page judged through the endpoint matches Jev's own judgment.
 * - A repeated request is answered from the shared cache.
 * - The endpoint refuses unknown questions, web-page origins, requests with
 *   no Origin, and requests with no install id.
 * - A spent daily allowance returns the "quota" error.
 * - A fresh install, built against the local endpoint with no settings,
 *   shades a page.
 *
 * The last check builds dist-e2e/ against the local endpoint.
 *
 *   node scripts/api-smoke.ts
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildTestExtension, fixturePages, serve } from "./serve.ts";
import type { PageSnapshot } from "../src/core/types.ts";

const PORT = 8799;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const INSTALL_LIMIT = 12;
/** A page title that makes the stand-in for TypeSafe fail with the status that follows it. */
const FAIL_UPSTREAM = "smoke: fail upstream with";
// The hosted transport reads its origin from this global, which esbuild defines in builds.
// Modules that import model.ts are imported dynamically, after the global is set.
(globalThis as unknown as { PD_API_ORIGIN: string }).PD_API_ORIGIN = ORIGIN;
const { DecisionError, hosted, jev } = await import("../src/decide/model.ts");
const { judgePage } = await import("../src/decide/judge.ts");
const { fileCache } = await import("./lib/cache.ts");
const { aggregateQuestions, numericQuestions } = await import("../src/decide/questions.ts");
type Question = import("../src/decide/model.ts").Question;
type NumericProfile = import("../src/core/profile.ts").NumericProfile;

/** Builds the extension's real role question for a column named `header`. */
const roleQuestion = (header: string) =>
  numericQuestions(0, { kind: "numeric", col: 0, header, decades: 0 } as unknown as NumericProfile).questions;

// ── Stand-in for TypeSafe ───────────────────────────────────────────────────

let upstreamCalls = 0;
/** Every Authorization header the endpoint sent upstream. A check below asserts on it. */
const upstreamAuth = new Set<string>();
/** The last request body that reached the stand-in for TypeSafe. */
let upstreamBody = "";
const upstream = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  upstreamCalls++;
  upstreamAuth.add(req.headers.authorization ?? "(none)");
  upstreamBody = raw;
  const failure = raw.match(new RegExp(`${FAIL_UPSTREAM} (\\d{3})`));
  if (failure !== null) return void res.writeHead(Number(failure[1]), { "Retry-After": "5" }).end("stand-in failure");
  const recorded = await readFile(
    `fixtures/recordings/${createHash("sha256").update(raw).digest("hex")}.json`,
    "utf8",
  ).catch(() => null);
  if (recorded !== null) return void res.writeHead(200, { "Content-Type": "application/json" }).end(recorded);
  // For a request with no recording, return a well-formed answer that picks the first option of each question.
  const { questions } = JSON.parse(raw) as { questions: Record<string, Question> };
  const answers = Object.fromEntries(
    Object.entries(questions).map(([id, q]) => {
      if (q.type === "noul") return [id, { type: "noul", noul: 0.5 }];
      const keys = q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
      return [
        id,
        {
          type: q.type,
          [q.type]: keys[0],
          probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0])),
          confidence: 1,
        },
      ];
    }),
  );
  res
    .writeHead(200, { "Content-Type": "application/json" })
    .end(JSON.stringify({ model: "jev-latest", answers, usage: { input_tokens: 100 } }));
});
await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
const upstreamPort = (upstream.address() as { port: number }).port;

// ── The endpoint ────────────────────────────────────────────────────────────

const wrangler = spawn(
  "npx",
  [
    // Use the wrangler in devDependencies. Never download one.
    "--no",
    "wrangler",
    "dev",
    "-c",
    "api/wrangler.jsonc",
    "--port",
    String(PORT),
    "--ip",
    "127.0.0.1",
    "--persist-to",
    "artifacts/api-dev",
    "--var",
    `UPSTREAM_URL:http://127.0.0.1:${upstreamPort}/v1/systemone`,
    "--var",
    "TYPESAFE_API_KEY:test-key",
    "--var",
    `INSTALL_DAILY_REQUESTS:${INSTALL_LIMIT}`,
    "--var",
    "STATS_TOKEN:smoke-stats",
    // The unpacked extension's id is not the store id.
    "--var",
    "ALLOWED_ORIGINS:",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
wrangler.stdout.on("data", (d) => (log += d));
wrangler.stderr.on("data", (d) => (log += d));

// Node sends no Origin, and the endpoint refuses a request without one. Requests from this
// script to the endpoint get an extension origin, as the extension's requests do.
const fetchWithoutOrigin = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (!String(input instanceof Request ? input.url : input).startsWith(ORIGIN)) return fetchWithoutOrigin(input, init);
  const headers = new Headers(init?.headers);
  if (!headers.has("origin")) headers.set("Origin", "chrome-extension://smoke");
  return fetchWithoutOrigin(input, { ...init, headers });
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${ORIGIN}/v1/systemone`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

let failed = false;
const check = async (name: string, f: () => Promise<void>) => {
  try {
    await f();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed = true;
    console.log(`  ✗ ${name}\n      ${String(e).split("\n").join("\n      ")}`);
  }
};

try {
  for (let i = 0; ; i++) {
    if (
      await fetch(`${ORIGIN}/v1/health`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    if (i > 120) throw new Error(`wrangler dev didn't start:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const page = JSON.parse(await readFile("fixtures/snapshots/github-copilot-pricing.json", "utf8")) as PageSnapshot;
  const install = randomUUID();

  await check("a page judged through the endpoint matches Jev's own judgment", async () => {
    const viaEndpoint = await judgePage(hosted(install), page);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("offline", { status: 401 });
    const direct = await judgePage(jev("", { cache: fileCache() }), page).finally(() => (globalThis.fetch = realFetch));
    assert.ok(viaEndpoint.usage.requests > 0);
    assert.deepEqual(
      viaEndpoint.tables.map((t) => t.encodings.map((e) => [e.header, e.kind, e.polarity])),
      direct.tables.map((t) => t.encodings.map((e) => [e.header, e.kind, e.polarity])),
    );
  });

  await check("a repeated request is answered from the shared cache", async () => {
    const calls = upstreamCalls;
    const again = await judgePage(hosted(randomUUID()), page);
    assert.ok(again.usage.requests > 0);
    assert.equal(upstreamCalls, calls, "upstream was called again");
  });

  await check("questions the extension doesn't ask are refused", async () => {
    const r = await post(
      { state: { page_title: "Inbox" }, questions: { q: { type: "noul", instructions: "Is this email spam?" } } },
      { "X-Practical-Data-Install": install },
    );
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { error: string }).error, "questions");
  });

  await check("a 10,000-character cell is forwarded clipped to 2,000 characters", async () => {
    const id = randomUUID();
    const rows = Array.from({ length: 5 }, () => ["Total", "x".repeat(10_000)]);
    const r = await post(
      { state: { page_title: `Long cell ${id}` }, questions: aggregateQuestions(["Name", "Notes"], rows).questions },
      { "X-Practical-Data-Install": id },
    );
    assert.equal(r.status, 200, await r.clone().text());
    const sent = JSON.parse(upstreamBody) as {
      questions: Record<string, { instructions: { row: { Notes: string } } }>;
    };
    assert.equal(sent.questions["row0.aggregate"]!.instructions.row.Notes, "x".repeat(2000));
  });

  await check("web pages are refused", async () => {
    const r = await post({}, { "X-Practical-Data-Install": install, Origin: "https://example.com" });
    assert.equal(r.status, 403);
  });

  await check("a request with no Origin is refused", async () => {
    const r = await fetchWithoutOrigin(`${ORIGIN}/v1/systemone`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Practical-Data-Install": install },
      body: "{}",
    });
    assert.equal(r.status, 403);
  });

  await check("a missing install id is refused", async () => {
    assert.equal((await post({})).status, 400);
  });

  await check("today's stats need the stats token", async () => {
    const stats = (authorization?: string) =>
      fetch(`${ORIGIN}/v1/stats`, authorization === undefined ? {} : { headers: { Authorization: authorization } });
    assert.equal((await stats()).status, 401);
    assert.equal((await stats("Bearer smoke-stat")).status, 401);
    const r = await stats("Bearer smoke-stats");
    assert.equal(r.status, 200);
    const body = (await r.json()) as { requests: number; tokens: number };
    assert.ok(body.requests > 0 && body.tokens > 0, JSON.stringify(body));
  });

  await check(
    `each request reports what's left, and after ${INSTALL_LIMIT} an install gets the quota error`,
    async () => {
      const id = randomUUID();
      let status = 0;
      let n = 0;
      for (; n <= INSTALL_LIMIT; n++) {
        // The run id stops answers that earlier runs cached in artifacts/api-dev from replaying.
        const r = await post(
          { state: { page_title: `Price ${n} ${id}` }, questions: roleQuestion(`Price ${n}`) },
          { "X-Practical-Data-Install": id },
        );
        status = r.status;
        // Each request that spends from the allowance reports what is left.
        assert.equal(r.headers.get("x-practical-data-limit"), String(INSTALL_LIMIT));
        assert.equal(r.headers.get("x-practical-data-remaining"), String(Math.max(0, INSTALL_LIMIT - n - 1)));
        if (status !== 200) {
          assert.equal(r.headers.get("x-practical-data-quota"), "install_limit");
          assert.match(
            ((await r.json()) as { message: string }).message,
            /^You've used today's free allowance\. It resets at midnight UTC/,
          );
          break;
        }
      }
      assert.equal(n, INSTALL_LIMIT, `refused after ${n}`);
      assert.equal(status, 429);
      const viaClient = await hosted(id)
        .evaluate({ state: { page_title: "Price 99" }, questions: roleQuestion("Price 99") })
        .then(
          () => assert.fail("the request after the allowance succeeded"),
          (e: unknown) => e,
        );
      assert.ok(viaClient instanceof DecisionError);
      assert.equal(viaClient.reason, "quota");
    },
  );

  // Runs after the quota check, whose unique run ids always reach upstream.
  await check("every upstream request carries the endpoint's TypeSafe key", async () => {
    assert.ok(upstreamCalls > 0, "upstream was never called");
    assert.deepEqual([...upstreamAuth], ["Bearer test-key"]);
  });

  await check("a request that fails upstream is a 503 and doesn't spend the allowance", async () => {
    const id = randomUUID();
    // An upstream 429 is not the endpoint's own rate limit, so the client must not read it as one.
    for (const status of [500, 429]) {
      const failed = await post(
        { state: { page_title: `${FAIL_UPSTREAM} ${status} ${id}` }, questions: roleQuestion("Price") },
        { "X-Practical-Data-Install": id },
      );
      assert.equal(failed.status, 503, `upstream ${status}`);
      assert.equal(failed.headers.get("retry-after"), "5");
    }
    const ok = await post(
      { state: { page_title: `after failure ${id}` }, questions: roleQuestion("Price") },
      { "X-Practical-Data-Install": id },
    );
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal(ok.headers.get("x-practical-data-remaining"), String(INSTALL_LIMIT - 1));
  });

  await check("a fresh install with no settings shades a page through the endpoint", async () => {
    const extensionArgs = buildTestExtension({ ...process.env, PD_API_ORIGIN: ORIGIN });
    const { pagesUrl: base, server } = await serve("fixtures");
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: extensionArgs,
    });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      assert.equal(
        await worker.evaluate(() => chrome.storage.local.get("settings").then((s) => s["settings"] ?? null)),
        null,
      );
      const fixture = (await fixturePages()).find((p) => p.slug === "github-copilot-pricing")!;
      const tab = await context.newPage();
      await tab.goto(`${base}/${fixture.path}`);
      await tab.waitForSelector("table[data-pd-encoded]:not([data-pd-encoded=''])", { timeout: 30_000 });
      const columns = await tab.$$eval("table[data-pd-encoded]", (ts) =>
        ts.reduce((n, t) => n + (t.getAttribute("data-pd-encoded") ?? "").split("|").filter(Boolean).length, 0),
      );
      assert.ok(columns > 0, "nothing shaded");
      assert.ok(!context.pages().some((p) => p.url().includes("options.html")), "options opened on install");
    } finally {
      await context.close();
      server.close();
    }
  });
} finally {
  wrangler.kill("SIGINT");
  upstream.close();
}
if (failed) {
  console.log(`\n${log.split("\n").slice(-30).join("\n")}`);
  process.exitCode = 1;
}
