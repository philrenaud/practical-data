import { test } from "node:test";
import assert from "node:assert/strict";
import { DecisionError, hosted, validateAnswers, type Question } from "../src/decide/model.ts";

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

/** The DecisionError that `promise` rejects with. Fails the test if it resolves or rejects with anything else. */
const rejection = (promise: Promise<unknown>): Promise<DecisionError> =>
  promise.then(
    () => assert.fail("expected a DecisionError"),
    (e: unknown) => {
      assert.ok(e instanceof DecisionError, String(e));
      return e;
    },
  );

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
    const error = await rejection(hosted("id").evaluate({ state: {}, questions }));
    assert.equal(error.reason, "quota");
    assert.equal(calls, 1);
    assert.ok(Date.now() - started < 1000);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a spent allowance for everyone is told apart from this install's own", async () => {
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
    const error = await rejection(hosted("id").evaluate({ state: {}, questions: { q: questions["log"]! } }));
    assert.equal(error.reason, "quota_everyone");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("hosted responses report what's left of the allowance; cache hits report nothing", async () => {
  const heard: unknown[] = [];
  const realFetch = globalThis.fetch;
  let hit = false;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(ok), {
      headers: hit ? { "X-Cache": "hit" } : { "X-Practical-Data-Remaining": "73", "X-Practical-Data-Limit": "400" },
    });
  try {
    const model = hosted("id", { onAllowance: (a) => heard.push(a) });
    await model.evaluate({ state: { n: 1 }, questions });
    hit = true;
    await model.evaluate({ state: { n: 2 }, questions });
    assert.deepEqual(heard, [{ remaining: 73, limit: 400 }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/** Counts the fetch calls that one evaluate makes when every response is a 503. */
const callsOn503 = async (provider: "hosted" | "jev"): Promise<number> => {
  const { hosted, jev } = await import("../src/decide/model.ts");
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{"error":"upstream"}', { status: 503 });
  };
  try {
    const model = provider === "hosted" ? hosted("id") : jev("key");
    const error = await rejection(model.evaluate({ state: {}, questions }));
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

// ── OpenRouter ──────────────────────────────────────────────────────────────

/** Replaces fetch with `respond` for one call of `run`, and returns the requests it received. */
const withFetch = async (
  respond: (body: { questions: Record<string, unknown> }) => unknown,
  run: () => Promise<void>,
): Promise<{ url: string; headers: Headers; body: { model: string; state: unknown; questions: object } }[]> => {
  const seen: { url: string; headers: Headers; body: { model: string; state: unknown; questions: object } }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    seen.push({ url: String(input), headers: new Headers(init?.headers), body });
    return new Response(JSON.stringify(respond(body)));
  };
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
  return seen;
};

test("OpenRouter gets the System One body at its decisions endpoint, with the model id and a bearer key", async () => {
  const { modelFromConfig } = await import("../src/decide/model.ts");
  const seen = await withFetch(
    () => ({ ...ok, id: "gen-dec-1", provider: "Microsoft", model: "microsoft/microsoft-decision-1.1-20261117" }),
    async () => {
      const model = modelFromConfig({
        provider: "openrouter",
        apiKey: "sk-or-test",
        model: "microsoft/microsoft-decision-1.1",
      });
      const response = await model.evaluate({ state: { table: 1 }, questions });
      assert.equal(model.name, "microsoft/microsoft-decision-1.1");
      assert.equal(response.model, "microsoft/microsoft-decision-1.1-20261117");
      assert.deepEqual(response.answers, ok.answers);
    },
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(seen[0]!.headers.get("authorization"), "Bearer sk-or-test");
  assert.deepEqual(seen[0]!.body, { model: "microsoft/microsoft-decision-1.1", state: { table: 1 }, questions });
});

test("OpenRouter answers without probabilities or confidence get them from the answer itself", async () => {
  const { openrouter } = await import("../src/decide/model.ts");
  const asked: Record<string, Question> = {
    role: questions["role"]!,
    order: { type: "score", instructions: "?", criteria: ["low", "mid", "high"] },
    keep: { type: "choice", instructions: "?", criteria: { yes: null, no: null } },
  };
  await withFetch(
    () => ({
      model: "m",
      usage: { input_tokens: 3, output_tokens: 0 },
      answers: {
        role: { type: "choice", choice: "measure" },
        order: { type: "score", score: 1.6, legend: { "0": "low", "1": "mid", "2": "high" } },
        keep: { type: "choice", choice: "yes", probabilities: { yes: 0.7, no: 0.3 } },
      },
    }),
    async () => {
      const { answers } = await openrouter("k", "m").evaluate({ state: {}, questions: asked });
      assert.deepEqual(answers["role"], {
        type: "choice",
        choice: "measure",
        probabilities: { measure: 1 },
        confidence: 1,
      });
      assert.deepEqual(answers["order"], { type: "score", score: 1.6, probabilities: { "2": 1 }, confidence: 1 });
      assert.deepEqual(answers["keep"], {
        type: "choice",
        choice: "yes",
        probabilities: { yes: 0.7, no: 0.3 },
        confidence: 0.7,
      });
    },
  );
});

test("a question that OpenRouter's provider refuses fails the request and names the question", async () => {
  const { openrouter } = await import("../src/decide/model.ts");
  await withFetch(
    () => ({ ...ok, answers: { role: ok.answers.role, log: { type: "refusal" } } }),
    async () => {
      const error = await rejection(openrouter("k", "m").evaluate({ state: {}, questions }));
      assert.equal(error.reason, "decode");
      assert.match(error.message, /log: refused/);
    },
  );
});

test("OpenRouter requests carry at most 64 questions", async () => {
  const { openrouter } = await import("../src/decide/model.ts");
  const many = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`q${i}`, questions["log"]!]));
  const seen = await withFetch(
    (body) => ({
      model: "m",
      usage: { input_tokens: 1 },
      answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "noul", noul: 0.5 }])),
    }),
    async () => {
      const response = await openrouter("k", "m").evaluate({ state: {}, questions: many });
      assert.equal(Object.keys(response.answers).length, 150);
      assert.equal(response.usage.input_tokens, 3);
    },
  );
  assert.deepEqual(seen.map((s) => Object.keys(s.body.questions).length).sort(), [22, 64, 64]);
});
