import { test } from "node:test";
import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { DecisionError, DecisionModel, type Answer, type DecisionRequest } from "../src/decide/model.ts";
import { judgePage } from "../src/decide/judge.ts";
import { followsRows } from "../src/decide/questions.ts";
import type { NumericProfile } from "../src/core/profile.ts";
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
    pricing(
      "t0",
      ["Model", "Category", "Input"],
      [
        ["A", "Lightweight", "$0.25"],
        ["B", "Powerful", "$15.00"],
        ["C", "Versatile", "$2.50"],
        ["D", "Lightweight", "$0.10"],
      ],
    ),
    pricing(
      "t1",
      ["Model", "Category", "Input"],
      [
        ["E", "Versatile", "$3.00"],
        ["F", "Powerful", "$30.00"],
        ["G", "Versatile", "$1.00"],
      ],
    ),
  ],
};

// Positions for the three category labels, keyed by label text in the question.
const rankOf: Record<string, number> = { Lightweight: 1, Versatile: 2, Powerful: 3, Default: 1, "Long context": 2 };

const answers = scripted((id, req) => {
  if (id.endsWith(".role")) return choice({ measure: 0.9, identifier: 0.05, time: 0.03, rank: 0.02 });
  if (id.endsWith(".polarity")) return choice({ lower_is_better: 0.9, higher_is_better: 0.05, neutral: 0.05 });
  if (id.endsWith(".log")) return { type: "noul", noul: 0.8 };
  if (id.endsWith(".relation"))
    return choice({ ordered_levels: 0.9, unordered_kinds: 0.1, workflow_states: 0, options: 0 });
  if (id.endsWith(".share")) return { type: "noul", noul: 0.9 };
  if (/\.lt\d+_\d+$/.test(id)) {
    const { a, b } = req.questions[id]!.instructions as { a: string; b: string };
    const known = a in rankOf && b in rankOf;
    return choice(
      known && rankOf[a]! < rankOf[b]! ? { a: 0.95, b: 0.05 } : known ? { a: 0.05, b: 0.95 } : { a: 0.5, b: 0.5 },
    );
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
  assert.deepEqual(
    t0!.skipped.map((s) => s.header),
    ["Model"],
  );
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
    [
      ["Model", "labels look like unordered kinds"],
      ["Category", "labels look like unordered kinds"],
      ["Input", "looks like identifier"],
    ],
  );
});

test("drops two-level ordinals unless a shared scale widens them", async () => {
  const tiers: PageSnapshot = {
    ...page,
    tables: [
      pricing(
        "t0",
        ["Model", "Tier", "Input"],
        [
          ["A", "Default", "$1.00"],
          ["B", "Long context", "$2.00"],
          ["C", "Default", "$1.50"],
        ],
      ),
    ],
  };
  const j = await Effect.runPromise(judgePage(tiers).pipe(Effect.provide(answers)));
  assert.deepEqual(
    j.tables[0]!.encodings.map((e) => e.header),
    ["Input"],
  );
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
  assert.deepEqual(
    inputs.map((e) => (e?.kind === "quantitative" ? e.domain : null)),
    [
      [0.1, 15],
      [1, 30],
    ],
  );
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
  assert.deepEqual(
    j.tables.map((t) => t.id),
    ["t0"],
  );
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
              ? choice({
                  ordered_levels: 0.05,
                  unordered_kinds: 0.95,
                  workflow_states: 0,
                  options: 0,
                  scores_or_records: 0,
                  names_or_versions: 0,
                })
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

test("never offers a share for same-named columns of different magnitude", async () => {
  // Home runs in the last five games (0 to 1) and per season (4 to 62): one header, not one scale.
  const games = pricing(
    "t0",
    ["Date", "HR"],
    [
      ["Sep 12", "0"],
      ["Sep 13", "1"],
      ["Sep 14", "0"],
      ["Sep 15", "1"],
    ],
  );
  const seasons = pricing(
    "t1",
    ["Season", "HR"],
    [
      ["2017", "52"],
      ["2022", "62"],
      ["2023", "37"],
      ["2016", "4"],
    ],
  );
  const asked: string[] = [];
  const spy = scripted((id, req) => {
    if (id.endsWith(".share")) asked.push(JSON.stringify(req.questions[id]!.instructions));
    if (id.endsWith(".role")) return choice({ measure: 0.9, identifier: 0.05, time: 0.03, rank: 0.02 });
    if (id.endsWith(".polarity")) return choice({ higher_is_better: 0.9, lower_is_better: 0.05, neutral: 0.05 });
    if (id.endsWith(".share")) return { type: "noul", noul: 0.9 };
    return choice({ unordered_kinds: 0.9, ordered_levels: 0.1, workflow_states: 0, options: 0 });
  });
  const j = await Effect.runPromise(judgePage({ ...page, tables: [games, seasons] }).pipe(Effect.provide(spy)));
  const hr = j.tables.map((t) => t.encodings.find((e) => e.header === "HR"));
  assert.ok(hr[0]?.kind === "quantitative" && hr[1]?.kind === "quantitative");
  assert.equal(hr[0].group, null);
  assert.equal(hr[1].group, null);
  assert.deepEqual(hr[0].domain, [0, 1]);
  assert.equal(asked.length, 0);
});

test("columns on one shared scale share one direction", async () => {
  // Two stores' prices; the model is sure about one table and unsure about the other.
  const a = pricing(
    "t0",
    ["Item", "Price"],
    [
      ["Kettle", "$39"],
      ["Toaster", "$54"],
      ["Blender", "$89"],
    ],
  );
  const b = pricing(
    "t1",
    ["Item", "Price"],
    [
      ["Kettle", "$35"],
      ["Toaster", "$59"],
      ["Blender", "$95"],
    ],
  );
  const split = scripted((id, req) => {
    const table = (req.state as { table_title?: string }).table_title;
    if (id.endsWith(".role")) return choice({ measure: 0.95, identifier: 0.02, time: 0.02, rank: 0.01 });
    if (id.endsWith(".polarity"))
      return table === "t0"
        ? choice({ lower_is_better: 0.9, higher_is_better: 0.05, neutral: 0.05 })
        : choice({ lower_is_better: 0.5, neutral: 0.45, higher_is_better: 0.05 });
    if (id.endsWith(".share")) return { type: "noul", noul: 0.9 };
    return choice({ unordered_kinds: 0.9, ordered_levels: 0.1, workflow_states: 0, options: 0 });
  });
  const j = await Effect.runPromise(judgePage({ ...page, tables: [a, b] }).pipe(Effect.provide(split)));
  const [p0, p1] = j.tables.map((t) => t.encodings.find((e) => e.header === "Price"));
  assert.ok(p0?.kind === "quantitative" && p1?.kind === "quantitative");
  assert.equal(p0.group, p1.group);
  assert.equal(p0.polarity, "lower_is_better");
  assert.equal(p1.polarity, "lower_is_better");
});

test("brackets that name the rows are ignored; brackets that are values are shaded", async () => {
  // Age brackets name each row, like years; a median-age bracket is a value of the row.
  const ages = pricing(
    "t0",
    ["Age group", "Median age", "Population"],
    [
      ["0–14", "5–9", "14,000"],
      ["15–64", "35–39", "72,000"],
      ["65+", "70–74", "36,000"],
      ["15–24", "20–24", "11,000"],
    ],
  );
  const bins = scripted((id) => {
    if (id.endsWith(".role"))
      return id.startsWith("n2.") ? choice({ measure: 0.95, bins: 0.05 }) : choice({ bins: 0.95, measure: 0.05 });
    if (id.endsWith(".polarity")) return choice({ neutral: 0.9, higher_is_better: 0.05, lower_is_better: 0.05 });
    return { type: "noul", noul: 0 };
  });
  const j = await Effect.runPromise(judgePage({ ...page, tables: [ages] }).pipe(Effect.provide(bins)));
  const shaded = j.tables[0]!.encodings.map((e) => e.header);
  assert.ok(!shaded.includes("Age group"), "row-naming brackets are ignored");
  assert.ok(shaded.includes("Median age"), "bracket values are shaded");
  assert.ok(shaded.includes("Population"));
});

test("ranks that count the rows, and ranks that don't", () => {
  const follows = (values: (number | null)[]) => followsRows({ values } as unknown as NumericProfile);
  assert.ok(follows([1, 2, 3, 4]));
  assert.ok(follows([51, 52, 53]), "a second page");
  assert.ok(follows([1, 1, 3, 4]), "ties, competition style");
  assert.ok(follows([1, 1, 2, 3]), "ties, dense style");
  assert.ok(follows([10, 9, 8, 7]), "counting down");
  assert.ok(follows([1, null, 3]));
  assert.ok(follows([7, 8, null, 10]), "a tie written once");
  assert.ok(!follows([2, 1, 5, 3]), "one outlet's ranking");
  assert.ok(!follows([3, 4, 5, 7, 8, 9, 9, 10]), "rising, but not one row at a time");
});

test("ranks in row order are ignored; ranks out of row order are shaded, on a linear scale", async () => {
  // A combined ranking sorted by its own order, beside one outlet's ranking of the same teams.
  const rankings = pricing(
    "t0",
    ["#", "Team", "Outlet A"],
    [
      ["1", "Gulls", "2"],
      ["2", "Owls", "1"],
      ["3", "Elks", "5"],
      ["4", "Foxes", "3"],
      ["5", "Hawks", "4"],
      ["6", "Bears", "12"],
      ["7", "Wolves", "6"],
      ["8", "Rams", "9"],
      ["9", "Jays", "7"],
      ["10", "Cats", "8"],
      ["11", "Lynx", "10"],
      ["12", "Pikes", "11"],
    ],
  );
  const ranks = scripted((id) => {
    if (id.endsWith(".role")) return choice({ rank: 0.9, measure: 0.1 });
    if (id.endsWith(".polarity")) return choice({ lower_is_better: 0.9, higher_is_better: 0.05, neutral: 0.05 });
    return { type: "noul", noul: 1 };
  });
  const j = await Effect.runPromise(judgePage({ ...page, tables: [rankings] }).pipe(Effect.provide(ranks)));
  const t = j.tables[0]!;
  assert.deepEqual(
    t.encodings.map((e) => e.header),
    ["Outlet A"],
  );
  const outlet = t.encodings[0]!;
  assert.ok(outlet.kind === "quantitative");
  assert.equal(outlet.polarity, "lower_is_better");
  assert.equal(outlet.transform, "linear", "the model's log answer is overruled for ranks");
  assert.equal(t.skipped.find((s) => s.header === "#")?.reason, "looks like rank");
});

test("date columns are shaded by code, never asked about, and never shared", async () => {
  const now = Date.UTC(2026, 9, 20);
  const asked: string[] = [];
  const model = scripted((id) => {
    asked.push(id);
    return { type: "noul", noul: 0 };
  });
  // Nine unique names: free text, so the only candidate column is the dates.
  const releases = (id: string) =>
    pricing(
      id,
      ["Set", "Released"],
      [
        ["Alpha", "August 5, 1993"],
        ["Beta", "October 4, 1993"],
        ["Unlimited", "December 1, 1993"],
        ["Arabian Nights", "December 17, 1993"],
        ["Antiquities", "March 4, 1994"],
        ["Legends", "June 1, 1994"],
        ["The Dark", "August 1, 1994"],
        ["Ice Age", "June 1995"],
        ["Mirage", "3 days ago"],
      ],
    );
  const j = await Effect.runPromise(
    judgePage(
      { url: "https://example.test", title: "Sets", tables: [releases("t0"), releases("t1")] },
      undefined,
      {},
      now,
    ).pipe(Effect.provide(model)),
  );
  assert.deepEqual(asked, []);
  assert.equal(j.usage.requests, 0);
  const e = j.tables[0]!.encodings[0]!;
  assert.equal(e.kind === "quantitative" && e.unit, "ago");
  assert.deepEqual(e.kind === "quantitative" && [e.polarity, e.transform, e.group], ["neutral", "linear", null]);
  assert.deepEqual(e.kind === "quantitative" && e.domain, [Date.UTC(1993, 7, 5), now - 3 * 86_400_000]);
  assert.deepEqual(
    j.tables[0]!.skipped.map((s) => s.header),
    ["Set"],
  );
});

test("a shared ordinal scale too wide to reorder leaves each table its own order", async () => {
  // Seven grades per table and thirteen across both: more than the union order asks about.
  const grades = Array.from({ length: 13 }, (_, i) => `G${String(i + 1).padStart(2, "0")}`);
  const graded = (id: string, levels: readonly string[]) =>
    pricing(
      id,
      ["Item", "Grade"],
      levels.map((g, i) => [`${id}-${i}`, g]),
    );
  const model = scripted((id, req) => {
    if (id.endsWith(".relation"))
      return choice({ ordered_levels: 0.95, unordered_kinds: 0.05, workflow_states: 0, options: 0 });
    if (id.endsWith(".polarity")) return choice({ higher_is_better: 0.9, lower_is_better: 0.05, neutral: 0.05 });
    if (id.endsWith(".share")) return { type: "noul", noul: 0.9 };
    if (/\.lt\d+_\d+$/.test(id)) {
      const { a, b } = req.questions[id]!.instructions as { a: string; b: string };
      return a < b ? choice({ a: 0.95, b: 0.05 }) : choice({ a: 0.05, b: 0.95 });
    }
    return { type: "noul", noul: 0 };
  });
  const tables = [graded("t0", grades.slice(0, 7)), graded("t1", grades.slice(6))];
  const j = await Effect.runPromise(judgePage({ ...page, tables }).pipe(Effect.provide(model)));
  const grade1 = j.tables[1]!.encodings.find((e) => e.header === "Grade");
  assert.ok(grade1?.kind === "ordinal");
  assert.deepEqual(
    grade1.order,
    grades.slice(6).map((g) => g.toLowerCase()),
  );
  assert.equal(grade1.group, null);
});
