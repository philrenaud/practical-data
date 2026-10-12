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
    role: { type: "choice" as const, choice: "measure", probabilities: { measure: 0.9, identifier: 0.1 }, confidence: 0.8 },
    log: { type: "noul" as const, noul: 0.3 },
  },
};

test("accepts answers that match the questions asked", () => {
  assert.equal(validateAnswers(questions, ok), null);
});

test("rejects missing answers, wrong types, unknown options and out-of-range probabilities", () => {
  assert.equal(validateAnswers(questions, { ...ok, answers: { role: ok.answers.role } }), "missing answer for log");
  assert.equal(validateAnswers(questions, { ...ok, answers: { ...ok.answers, log: ok.answers.role } }), "log: expected noul, got choice");
  assert.equal(
    validateAnswers(questions, { ...ok, answers: { ...ok.answers, role: { ...ok.answers.role, probabilities: { measure: 0.9, rank: 0.1 } } } }),
    "role: unexpected option rank",
  );
  assert.equal(validateAnswers(questions, { ...ok, answers: { ...ok.answers, log: { type: "noul", noul: 2 } } }), "log: noul 2 out of range");
});

test("a spent hosted allowance fails at once as quota, without waiting or retrying", async () => {
  const { Effect } = await import("effect");
  const { hosted } = await import("../src/decide/model.ts");
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{"error":"install_limit"}', { status: 429, headers: { "Retry-After": "40000", "X-Practical-Data-Quota": "install_limit" } });
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
