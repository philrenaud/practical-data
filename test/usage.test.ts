import { test } from "node:test";
import assert from "node:assert/strict";
import { usagePoint } from "../src/api/usage.ts";

const answer = { model: "jev-latest", answers: {}, usage: { input_tokens: 1234 } };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

test("a model answer records its tokens and the install's count today", async () => {
  const r = json(200, answer, { "X-Practical-Data-Remaining": "390", "X-Practical-Data-Limit": "400" });
  assert.deepEqual(await usagePoint("/v1/systemone", r), {
    blobs: ["systemone", "model"],
    doubles: [200, 1234, 10, 0],
    indexes: ["model"],
  });
});

test("a cache hit records no tokens and no count", async () => {
  assert.deepEqual(await usagePoint("/v1/systemone", json(200, answer)), {
    blobs: ["systemone", "cache"],
    doubles: [200, 0, 0, 0],
    indexes: ["cache"],
  });
});

test("a refusal records its error code", async () => {
  const origin = json(403, { error: "origin", message: "…" });
  assert.deepEqual((await usagePoint("/v1/systemone", origin)).blobs, ["systemone", "origin"]);
  const limit = json(
    429,
    { error: "install_limit", message: "…" },
    { "X-Practical-Data-Remaining": "0", "X-Practical-Data-Limit": "400" },
  );
  assert.deepEqual(await usagePoint("/v1/systemone", limit), {
    blobs: ["systemone", "install_limit"],
    doubles: [429, 0, 400, 0],
    indexes: ["install_limit"],
  });
});

test("an upstream refusal records the provider's status", async () => {
  const r = json(502, { error: "upstream", message: "The model returned 400.", upstream: 400 });
  assert.deepEqual(await usagePoint("/v1/systemone", r), {
    blobs: ["systemone", "upstream"],
    doubles: [502, 0, 0, 400],
    indexes: ["upstream"],
  });
});

test("other routes and unreadable bodies", async () => {
  assert.deepEqual((await usagePoint("/wp-login.php", json(404, { error: "not_found" }))).blobs, [
    "other",
    "not_found",
  ]);
  assert.deepEqual((await usagePoint("/v1/stats", json(200, { day: "2026-10-21" }))).blobs, ["stats", "ok"]);
  assert.deepEqual((await usagePoint("/v1/systemone", new Response("oops", { status: 500 }))).blobs, [
    "systemone",
    "error",
  ]);
});
