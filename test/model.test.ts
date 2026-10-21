import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAnswers, type Question } from "../src/decide/model.ts";

const questions: Record<string, Question> = {
  role: { type: "choice", instructions: "?", criteria: { measure: null, identifier: null } },
  log: { type: "noul", instructions: "?" },
};
const ok = {
  model: "jev",
  usage: { input_tokens: 1 },
  answers: {
    role: {
      type: "choice" as const,
      choice: "measure",
      probabilities: { measure: 0.9, identifier: 0.1 },
      confidence: 0.8,
    },
    log: { type: "noul" as const, noul: 0.3 },
  },
};

test("accepts answers that match the questions asked", () => {
  assert.equal(validateAnswers(questions, ok), null);
});

test("rejects missing answers, wrong types, unknown options and out-of-range probabilities", () => {
  assert.equal(validateAnswers(questions, { ...ok, answers: { role: ok.answers.role } }), "missing answer for log");
  assert.equal(
    validateAnswers(questions, { ...ok, answers: { ...ok.answers, log: ok.answers.role } }),
    "log: expected noul, got choice",
  );
  assert.equal(
    validateAnswers(questions, {
      ...ok,
      answers: { ...ok.answers, role: { ...ok.answers.role, probabilities: { measure: 0.9, rank: 0.1 } } },
    }),
    "role: unexpected option rank",
  );
  assert.equal(
    validateAnswers(questions, { ...ok, answers: { ...ok.answers, log: { type: "noul", noul: 2 } } }),
    "log: noul 2 out of range",
  );
});

test("a spent hosted allowance fails at once as quota, without waiting or retrying", async () => {
  const { Effect } = await import("effect");
  const { hosted } = await import("../src/decide/model.ts");
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{"error":"install_limit"}', {
      status: 429,
      headers: { "Retry-After": "40000", "X-Practical-Data-Quota": "install_limit" },
    });
  };
  try {
    const started = Date.now();
    const error = await Effect.runPromise(hosted("id").evaluate({ state: {}, questions }).pipe(Effect.flip));
    assert.equal(error.reason, "quota");
    assert.equal(calls, 1);
    assert.ok(Date.now() - started < 1000);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a spent allowance for everyone is told apart from this install's own", async () => {
  const { Effect } = await import("effect");
  const { hosted } = await import("../src/decide/model.ts");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('{"error":"budget_spent"}', {
      status: 429,
      headers: {
        "X-Practical-Data-Quota": "budget_spent",
        "X-Practical-Data-Remaining": "250",
        "X-Practical-Data-Limit": "400",
      },
    });
  try {
    const error = await Effect.runPromise(
      hosted("id")
        .evaluate({ state: {}, questions: { q: questions["log"]! } })
        .pipe(Effect.flip),
    );
    assert.equal(error.reason, "quota_everyone");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("hosted responses report what's left of the allowance; cache hits report nothing", async () => {
  const { Effect } = await import("effect");
  const { hosted } = await import("../src/decide/model.ts");
  const heard: unknown[] = [];
  const realFetch = globalThis.fetch;
  let hit = false;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(ok), {
      headers: hit ? { "X-Cache": "hit" } : { "X-Practical-Data-Remaining": "73", "X-Practical-Data-Limit": "400" },
    });
  try {
    const model = hosted("id", (a) => heard.push(a));
    await Effect.runPromise(model.evaluate({ state: { n: 1 }, questions }));
    hit = true;
    await Effect.runPromise(model.evaluate({ state: { n: 2 }, questions }));
    assert.deepEqual(heard, [{ remaining: 73, limit: 400 }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/** Counts the fetch calls that one evaluate makes when every response is a 503. */
const callsOn503 = async (provider: "hosted" | "jev"): Promise<number> => {
  const { Effect } = await import("effect");
  const { hosted, jev } = await import("../src/decide/model.ts");
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{"error":"upstream"}', { status: 503 });
  };
  try {
    const model = provider === "hosted" ? hosted("id") : jev("key");
    const error = await Effect.runPromise(model.evaluate({ state: {}, questions }).pipe(Effect.flip));
    assert.equal(error.reason, "overloaded");
    return calls;
  } finally {
    globalThis.fetch = realFetch;
  }
};

test("the hosted endpoint retries a 503 only once, because each attempt spends from the allowance", async () => {
  assert.equal(await callsOn503("hosted"), 2);
});

test("Jev retries a 503 four times", async () => {
  assert.equal(await callsOn503("jev"), 5);
});
