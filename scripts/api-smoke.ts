/**
 * Runs the hosted endpoint locally (`wrangler dev`) against a stand-in for
 * TypeSafe that replays fixtures/recordings, then checks what the extension
 * and an abuser would see: a whole page judged through the endpoint matches
 * Jev's own judgment, as does a table sent whole to /v1/judge (the Sheets
 * add-on's route), repeats come from the shared cache, foreign questions,
 * web-page origins and missing install ids are refused, and a spent daily
 * allowance surfaces as the "quota" error. Last, a fresh install of the
 * extension, built against the local endpoint and given no settings at all,
 * shades a page (dist/ is rebuilt for production afterwards).
 *
 *   node scripts/api-smoke.ts
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { chromium } from "playwright";
import { fixturePages, serve } from "./serve.ts";
import type { PageSnapshot } from "../src/core/types.ts";

const PORT = 8799;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const INSTALL_LIMIT = 12;
// The hosted transport reads its origin from this global (esbuild defines it in builds), so
// everything that imports model.ts is imported dynamically, after it is set.
(globalThis as unknown as { PD_API_ORIGIN: string }).PD_API_ORIGIN = ORIGIN;
const { DecisionError, DecisionModel, hosted, jev } = await import("../src/decide/model.ts");
const { judgePage } = await import("../src/decide/judge.ts");
const { fileCache } = await import("./lib/cache.ts");
const { numericQuestions } = await import("../src/decide/questions.ts");
type Question = import("../src/decide/model.ts").Question;
type NumericProfile = import("../src/core/profile.ts").NumericProfile;

/** A real "what kind of numbers" question, for a column called `header`. */
const roleQuestion = (header: string) =>
  numericQuestions(0, { kind: "numeric", col: 0, header, decades: 0 } as unknown as NumericProfile).questions;

// ── Stand-in for TypeSafe ───────────────────────────────────────────────────

let upstreamCalls = 0;
const upstream = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  upstreamCalls++;
  assert.equal(req.headers.authorization, "Bearer test-key");
  const recorded = await readFile(`fixtures/recordings/${createHash("sha256").update(raw).digest("hex")}.json`, "utf8").catch(() => null);
  if (recorded !== null) return void res.writeHead(200, { "Content-Type": "application/json" }).end(recorded);
  // Unrecorded: a well-formed answer that picks each question's first option.
  const { questions } = JSON.parse(raw) as { questions: Record<string, Question> };
  const answers = Object.fromEntries(
    Object.entries(questions).map(([id, q]) => {
      if (q.type === "noul") return [id, { type: "noul", noul: 0.5 }];
      const keys = q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
      return [id, { type: q.type, [q.type]: keys[0], probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0])), confidence: 1 }];
    }),
  );
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ model: "jev-latest", answers, usage: { input_tokens: 100 } }));
});
await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
const upstreamPort = (upstream.address() as { port: number }).port;

// ── The endpoint ────────────────────────────────────────────────────────────

const wrangler = spawn(
  "npx",
  [
    "wrangler@4.147.0", "dev", "-c", "api/wrangler.jsonc", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", "artifacts/api-dev",
    "--var", `UPSTREAM_URL:http://127.0.0.1:${upstreamPort}/v1/systemone`,
    "--var", "TYPESAFE_API_KEY:test-key",
    "--var", `INSTALL_DAILY_REQUESTS:${INSTALL_LIMIT}`,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
wrangler.stdout.on("data", (d) => (log += d));
wrangler.stderr.on("data", (d) => (log += d));

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${ORIGIN}/v1/${body !== null && typeof body === "object" && "table" in body ? "judge" : "systemone"}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

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
    if (await fetch(`${ORIGIN}/v1/health`).then((r) => r.ok, () => false)) break;
    if (i > 120) throw new Error(`wrangler dev didn't start:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const page = JSON.parse(await readFile("fixtures/snapshots/github-copilot-pricing.json", "utf8")) as PageSnapshot;
  const install = randomUUID();

  await check("a page judged through the endpoint matches Jev's own judgment", async () => {
    const viaEndpoint = await Effect.runPromise(judgePage(page).pipe(Effect.provide(Layer.succeed(DecisionModel, hosted(install)))));
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("offline", { status: 401 });
    const direct = await Effect.runPromise(
      judgePage(page).pipe(Effect.provide(Layer.merge(Layer.succeed(DecisionModel, jev("")), fileCache()))),
    ).finally(() => (globalThis.fetch = realFetch));
    assert.ok(viaEndpoint.usage.requests > 0);
    assert.deepEqual(
      viaEndpoint.tables.map((t) => t.encodings.map((e) => [e.header, e.kind, e.polarity])),
      direct.tables.map((t) => t.encodings.map((e) => [e.header, e.kind, e.polarity])),
    );
  });

  await check("a repeated request is answered from the shared cache", async () => {
    const calls = upstreamCalls;
    const again = await Effect.runPromise(judgePage(page).pipe(Effect.provide(Layer.succeed(DecisionModel, hosted(randomUUID())))));
    assert.ok(again.usage.requests > 0);
    assert.equal(upstreamCalls, calls, "upstream was called again");
  });

  await check("a table sent whole to /v1/judge is judged as the extension would judge it", async () => {
    const table = page.tables.find((t) => t.rows.length >= 3)!;
    const r = await post({ title: page.title, table: { title: table.title, headers: table.headers, rows: table.rows } }, { "X-Practical-Data-Install": install });
    assert.equal(r.status, 200, await r.clone().text());
    const { table: judged } = (await r.json()) as { table: import("../src/core/types.ts").TableJudgment };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("offline", { status: 401 });
    const direct = await Effect.runPromise(
      judgePage({ url: "", title: page.title, tables: [{ ...table, id: "t0" }] }).pipe(
        Effect.provide(Layer.merge(Layer.succeed(DecisionModel, jev("")), fileCache())),
      ),
    ).finally(() => (globalThis.fetch = realFetch));
    assert.ok(judged.encodings.length > 0, "nothing judged");
    assert.deepEqual(judged, direct.tables[0]);
  });

  await check("questions the extension doesn't ask are refused", async () => {
    const r = await post({ state: {}, questions: { q: { type: "noul", instructions: "Is this email spam?" } } }, { "X-Practical-Data-Install": install });
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { error: string }).error, "questions");
  });

  await check("web pages are refused", async () => {
    const r = await post({}, { "X-Practical-Data-Install": install, Origin: "https://example.com" });
    assert.equal(r.status, 403);
  });

  await check("a missing install id is refused", async () => {
    assert.equal((await post({})).status, 400);
  });

  await check(`after ${INSTALL_LIMIT} model requests, an install gets the quota error`, async () => {
    const id = randomUUID();
    const role = roleQuestion;
    let status = 0;
    let n = 0;
    for (; n <= INSTALL_LIMIT; n++) {
      const r = await post({ state: { n }, questions: role(`Price ${n}`) }, { "X-Practical-Data-Install": id });
      status = r.status;
      if (status !== 200) {
        assert.equal(r.headers.get("x-practical-data-quota"), "install_limit");
        break;
      }
    }
    assert.equal(n, INSTALL_LIMIT, `refused after ${n}`);
    assert.equal(status, 429);
    const viaClient = await Effect.runPromise(
      hosted(id).evaluate({ state: { n: 99 }, questions: role("Price 99") }).pipe(Effect.flip),
    );
    assert.ok(viaClient instanceof DecisionError);
    assert.equal(viaClient.reason, "quota");
  });

  await check("a fresh install with no settings shades a page through the endpoint", async () => {
    execFileSync("node", ["scripts/build.ts"], { env: { ...process.env, PD_API_ORIGIN: ORIGIN }, stdio: "ignore" });
    const { url: base, server } = await serve("fixtures");
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: ["--disable-extensions-except=dist", "--load-extension=dist"],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      assert.equal(await worker.evaluate(() => chrome.storage.local.get("settings").then((s) => s["settings"] ?? null)), null);
      const fixture = (await fixturePages()).find((p) => p.slug === "github-copilot-pricing")!;
      const tab = await context.newPage();
      await tab.goto(`${base}/${fixture.path}`);
      await tab.waitForSelector("table[data-pd-encoded]:not([data-pd-encoded=''])", { timeout: 30_000 });
      const columns = await tab.$$eval("table[data-pd-encoded]", (ts) => ts.reduce((n, t) => n + (t.getAttribute("data-pd-encoded") ?? "").split("|").filter(Boolean).length, 0));
      assert.ok(columns > 0, "nothing shaded");
      assert.ok(!context.pages().some((p) => p.url().includes("options.html")), "options opened on install");
    } finally {
      await context.close();
      server.close();
      execFileSync("node", ["scripts/build.ts"], { stdio: "ignore" });
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
