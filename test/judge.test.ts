import { test } from "node:test";
import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { DecisionError, DecisionModel, type Answer, type DecisionRequest } from "../src/decide/model.ts";
import { judgePage } from "../src/decide/judge.ts";
import type { PageSnapshot } from "../src/core/types.ts";

/** A fake model that answers by question id, so tests exercise judge composition, not inference. */
const scripted = (answer: (id: string, req: DecisionRequest) => Answer) =>
  Layer.succeed(DecisionModel, {
    name: "scripted",
    evaluate: (req) =>
      Effect.succeed({
        model: "scripted",
        answers: Object.fromEntries(Object.keys(req.questions).map((id) => [id, answer(id, req)])),
        usage: { input_tokens: 1 },
      }),
  });

const choice = (probabilities: Record<string, number>): Answer => {
  const [choice] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]!;
  return { type: "choice", choice, probabilities, confidence: 1 };
};

const pricing = (id: string, headers: string[], rows: string[][]) => ({ id, title: id, headers, rows });

const page: PageSnapshot = {
  url: "https://example.test",
  title: "Pricing",
  tables: [
    pricing("t0", ["Model", "Category", "Input"], [
      ["A", "Lightweight", "$0.25"],
      ["B", "Powerful", "$15.00"],
      ["C", "Versatile", "$2.50"],
      ["D", "Lightweight", "$0.10"],
    ]),
    pricing("t1", ["Model", "Category", "Input"], [
      ["E", "Versatile", "$3.00"],
      ["F", "Powerful", "$30.00"],
      ["G", "Versatile", "$1.00"],
    ]),
  ],
};

// Positions for the three category labels, keyed by label text in the question.
const rankOf: Record<string, number> = { Lightweight: 1, Versatile: 2, Powerful: 3, Default: 1, "Long context": 2 };

const answers = scripted((id, req) => {
  if (id.endsWith(".role")) return choice({ measure: 0.9, identifier: 0.05, time: 0.03, rank: 0.02 });
  if (id.endsWith(".polarity")) return choice({ lower_is_better: 0.9, higher_is_better: 0.05, neutral: 0.05 });
  if (id.endsWith(".log")) return { type: "noul", noul: 0.8 };
  if (id.endsWith(".relation")) return choice({ ordered_levels: 0.9, unordered_kinds: 0.1, workflow_states: 0, options: 0 });
  if (id.endsWith(".share")) return { type: "noul", noul: 0.9 };
  if (/\.lt\d+_\d+$/.test(id)) {
    const { a, b } = req.questions[id]!.instructions as { a: string; b: string };
    const known = a in rankOf && b in rankOf;
    return choice(known && rankOf[a]! < rankOf[b]! ? { a: 0.95, b: 0.05 } : known ? { a: 0.05, b: 0.95 } : { a: 0.5, b: 0.5 });
  }
  return { type: "noul", noul: 0 };
});

test("judges price and category columns, sharing scales across tables", async () => {
  const j = await Effect.runPromise(judgePage(page).pipe(Effect.provide(answers)));
  const [t0, t1] = j.tables;
  const input0 = t0!.encodings.find((e) => e.header === "Input");
  const input1 = t1!.encodings.find((e) => e.header === "Input");
  assert.ok(input0?.kind === "quantitative" && input1?.kind === "quantitative");
  assert.equal(input0.polarity, "lower_is_better");
  assert.equal(input0.transform, "log");
  assert.deepEqual(input0.domain, [0.1, 30]);
  assert.deepEqual(input1.domain, [0.1, 30]);
  assert.equal(input0.group, input1.group);

  const cat1 = t1!.encodings.find((e) => e.header === "Category");
  assert.ok(cat1?.kind === "ordinal");
  // t1 has no "Lightweight" row, but the shared order still spans all three levels.
  assert.deepEqual(cat1.order, ["lightweight", "versatile", "powerful"]);
  assert.deepEqual(t0!.skipped.map((s) => s.header), ["Model"]);
  // Per table: numeric request, then per label column (Model, Category) a relation request and,
  // because the script calls everything ordered, a pairwise request; then one share request.
  assert.equal(j.usage.requests, 11);
});

test("declines numeric columns the model calls identifiers", async () => {
  const ids = scripted((id) =>
    id.endsWith(".role")
      ? choice({ measure: 0.1, identifier: 0.85, time: 0.03, rank: 0.02 })
      : id.endsWith(".relation")
        ? choice({ ordered_levels: 0.05, unordered_kinds: 0.9, workflow_states: 0.05, options: 0 })
        : { type: "noul", noul: 0 },
  );
  const j = await Effect.runPromise(judgePage({ ...page, tables: [page.tables[0]!] }).pipe(Effect.provide(ids)));
  assert.deepEqual(j.tables[0]!.encodings, []);
  assert.deepEqual(
    j.tables[0]!.skipped.map((s) => [s.header, s.reason]),
    [["Model", "labels look like unordered kinds"], ["Category", "labels look like unordered kinds"], ["Input", "looks like identifier"]],
  );
});

test("drops two-level ordinals unless a shared scale widens them", async () => {
  const tiers: PageSnapshot = {
    ...page,
    tables: [
      pricing("t0", ["Model", "Tier", "Input"], [
        ["A", "Default", "$1.00"],
        ["B", "Long context", "$2.00"],
        ["C", "Default", "$1.50"],
      ]),
    ],
  };
  const j = await Effect.runPromise(judgePage(tiers).pipe(Effect.provide(answers)));
  assert.deepEqual(j.tables[0]!.encodings.map((e) => e.header), ["Input"]);
  assert.equal(j.tables[0]!.skipped.find((s) => s.header === "Tier")?.reason, "only two levels");

  // t1 in the shared page has only Versatile/Powerful, yet keeps color via t0's three-level scale.
  const shared = await Effect.runPromise(judgePage(page).pipe(Effect.provide(answers)));
  assert.ok(shared.tables[1]!.encodings.some((e) => e.header === "Category"));
});

test("a failed share request keeps per-table scales instead of failing the page", async () => {
  const flaky = Layer.succeed(DecisionModel, {
    name: "flaky",
    evaluate: (req) =>
      Object.keys(req.questions).some((id) => id.endsWith(".share"))
        ? Effect.fail(new DecisionError({ reason: "overloaded", message: "529" }))
        : Effect.gen(function* () {
            const model = yield* DecisionModel;
            return yield* model.evaluate(req);
          }).pipe(Effect.provide(answers)),
  });
  const j = await Effect.runPromise(judgePage(page).pipe(Effect.provide(flaky)));
  const inputs = j.tables.map((t) => t.encodings.find((e) => e.header === "Input"));
  assert.ok(inputs.every((e) => e?.kind === "quantitative" && e.group === null));
  assert.deepEqual(inputs.map((e) => (e?.kind === "quantitative" ? e.domain : null)), [[0.1, 15], [1, 30]]);
});

test("one table's failure leaves the other tables judged", async () => {
  const failSecond = Layer.succeed(DecisionModel, {
    name: "partial",
    evaluate: (req) =>
      JSON.stringify(req.state).includes('"F"') || JSON.stringify(req.state).includes("$30.00")
        ? Effect.fail(new DecisionError({ reason: "overloaded", message: "529" }))
        : Effect.gen(function* () {
            const model = yield* DecisionModel;
            return yield* model.evaluate(req);
          }).pipe(Effect.provide(answers)),
  });
  const j = await Effect.runPromise(judgePage(page).pipe(Effect.provide(failSecond)));
  assert.deepEqual(j.tables.map((t) => t.id), ["t0"]);
  assert.deepEqual(j.failed, [{ id: "t1", reason: "overloaded" }]);
});

test("unordered label columns never send pairwise order questions", async () => {
  const asked: string[] = [];
  const unordered = Layer.succeed(DecisionModel, {
    name: "unordered",
    evaluate: (req) => {
      asked.push(...Object.keys(req.questions));
      return Effect.succeed({
        model: "unordered",
        answers: Object.fromEntries(
          Object.keys(req.questions).map((id) => [
            id,
            id.endsWith(".relation")
              ? choice({ ordered_levels: 0.05, unordered_kinds: 0.95, workflow_states: 0, options: 0, scores_or_records: 0, names_or_versions: 0 })
              : id.endsWith(".role")
                ? choice({ measure: 0.9, identifier: 0.1, time: 0, rank: 0, bins: 0, record: 0, threshold: 0 })
                : id.endsWith(".polarity")
                  ? choice({ higher_is_better: 0.1, lower_is_better: 0.8, neutral: 0.1 })
                  : ({ type: "noul", noul: 0 } as Answer),
          ]),
        ),
        usage: { input_tokens: 1 },
      });
    },
  });
  await Effect.runPromise(judgePage({ ...page, tables: [page.tables[0]!] }).pipe(Effect.provide(unordered)));
  assert.equal(asked.filter((id) => /\.lt\d+_\d+$/.test(id)).length, 0);
});
