/**
 * The judging program: page snapshot in, color encodings out.
 *
 * 1. Profile every table in code.
 * 2. One request per table (run concurrently) asks about every candidate column.
 * 3. Readers + `Policy` thresholds turn probabilities into encodings.
 * 4. One page-level request asks whether same-named columns across tables
 *    should share a scale, then widens their domains / merges their orders.
 */
import { Effect } from "effect";
import { orderFromPairs } from "../core/order.ts";
import { transposeSnapshot, type Orientation } from "../core/orient.ts";
import type { CategoricalProfile, NumericProfile } from "../core/profile.ts";
import { profileTable } from "../core/profile.ts";
import { normalizeLabel } from "../core/parse.ts";
import type {
  ColumnEncoding,
  PageJudgment,
  PageSnapshot,
  Polarity,
  SkippedColumn,
  TableJudgment,
  TableSnapshot,
} from "../core/types.ts";
import { DecisionError, DecisionModel, type Question } from "./model.ts";
import {
  aggregateQuestions,
  type Answers,
  categoricalQuestions,
  noul,
  numericQuestions,
  pairQuestions,
  shareQuestion,
  categoricalState,
  orientationQuestion,
  tableState,
} from "./questions.ts";

/** Probability thresholds. Tuned against `fixtures/expectations.json` by `npm run eval`. */
export interface Policy {
  readonly measure: number;
  readonly ordinal: number;
  readonly orderConfidence: number;
  readonly log: number;
  /** Below this, a polarity call falls back to neutral. */
  readonly polarity: number;
  readonly aggregate: number;
  readonly share: number;
  /** P(values compare across rows) needed to judge a table transposed. */
  readonly rows: number;
  /**
   * A middling "ordered levels" probability still counts when the pairwise
   * comparisons agree strongly: consistent pairwise answers are evidence the
   * order is real (Lightweight < Versatile < Powerful scores ~0.6 / 0.95).
   */
  readonly ordinalWithStrongOrder: number;
  readonly strongOrder: number;
}

/**
 * Coloring needs the model to be at least "fairly sure" (0.7) that a column is
 * comparable and, for categories, of their order. An unsure *direction* still
 * colors, on the neutral scale.
 */
export const DEFAULT_POLICY: Policy = {
  measure: 0.7,
  ordinal: 0.7,
  orderConfidence: 0.7,
  log: 0.5,
  polarity: 0.55,
  aggregate: 0.5,
  share: 0.5,
  rows: 0.75,
  ordinalWithStrongOrder: 0.5,
  strongOrder: 0.85,
};

const MIN_ROWS = 3;
/** Rows become columns when transposed; past this, each would be its own question set. */
export const MAX_TRANSPOSE_ROWS = 40;
/** Cap on labels merged across tables before asking pairwise order questions. */
const MAX_UNION_LEVELS = 12;

const pickPolarity = (p: Readonly<Record<Polarity, number>>, threshold: number): Polarity => {
  if (p.higher_is_better >= threshold) return "higher_is_better";
  if (p.lower_is_better >= threshold) return "lower_is_better";
  return "neutral";
};

const extent = (values: readonly (number | null)[], exclude: ReadonlySet<number>): [number, number] => {
  let lo = Infinity;
  let hi = -Infinity;
  values.forEach((v, i) => {
    if (v === null || exclude.has(i)) return;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  });
  return [lo, hi];
};

interface Planned {
  readonly table: TableSnapshot;
  readonly judgment: TableJudgment;
  /** Samples per encoded column, for cross-table questions. */
  readonly samples: ReadonlyMap<number, readonly string[]>;
  readonly units: ReadonlyMap<number, string | null>;
}

/** One table, judged column by column. Optionally asks the orientation question too. */
const judgeColumns = (page: PageSnapshot, table: TableSnapshot, policy: Policy, askOrientation: boolean) =>
  Effect.gen(function* () {
    const model = yield* DecisionModel;
    const profiles = profileTable(table);
    const candidates = profiles.filter(
      (p): p is NumericProfile | CategoricalProfile => p.kind === "numeric" || p.kind === "categorical",
    );
    const skipped: SkippedColumn[] = profiles.flatMap((p) =>
      p.kind === "text" ? [{ col: p.col, header: p.header, reason: p.reason, comparable: null }] : [],
    );
    const empty: Planned = {
      table,
      judgment: { id: table.id, orientation: "columns", rowsScore: null, encodings: [], skipped, aggregateRows: [] },
      samples: new Map(),
      units: new Map(),
    };
    if (candidates.length === 0 || table.rows.length < MIN_ROWS) return { planned: empty, rowsScore: null };

    const ctx = { page: page.title, table: table.title };
    const numeric = candidates.filter((p) => p.kind === "numeric");
    const categorical = candidates.filter((p) => p.kind === "categorical");
    const numericPlans = numeric.map((p, k) => ({ profile: p, ...numericQuestions(k, p) }));
    const aggregates = aggregateQuestions(table.headers, table.rows);
    // Orientation only matters when several numeric columns could be read either way.
    const orientation =
      askOrientation && numeric.length >= 2
        ? orientationQuestion({ header: table.headers[0] ?? "", examples: table.rows.slice(0, 5).map((r) => r[0] ?? "") })
        : null;

    // One request for the numeric columns and aggregate rows, plus one focused
    // request per categorical column, all in flight together.
    const [tableAnswers, ...categoricalAnswers] = yield* Effect.all(
      [
        model.evaluate({
          state: tableState(ctx, profiles, numeric),
          questions: Object.assign(
            {},
            aggregates.questions,
            orientation?.questions ?? {},
            ...numericPlans.map((p) => p.questions),
          ),
        }),
        ...categorical.map((p) =>
          Effect.gen(function* () {
            const q = categoricalQuestions(p);
            const state = categoricalState(ctx, p, table.headers.filter((h, i) => i !== p.col && h !== ""));
            const first = yield* model.evaluate({ state, questions: q.questions });
            // Pairwise order questions only when the labels might be ordered (a 12-team
            // column would otherwise send 132 of them).
            if (q.ordinalOf(first.answers) < policy.ordinalWithStrongOrder) return first;
            const pairs = yield* model.evaluate({ state, questions: q.pairQuestions });
            return { ...first, answers: { ...first.answers, ...pairs.answers } };
          }),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const answers = tableAnswers!.answers;
    const aggregateRows = aggregates.read(answers, policy.aggregate);
    const excluded = new Set(aggregateRows);
    const plans = [
      ...numericPlans.map((plan) => ({ kind: "numeric" as const, ...plan, answers })),
      ...categorical.map((p, i) => ({
        kind: "categorical" as const,
        profile: p,
        read: categoricalQuestions(p).read,
        answers: categoricalAnswers[i]!.answers,
      })),
    ];

    const encodings: ColumnEncoding[] = [];
    const samples = new Map<number, readonly string[]>();
    const units = new Map<number, string | null>();
    for (const plan of plans) {
      if (plan.kind === "numeric") {
        const p = plan.profile;
        const r = plan.read(plan.answers);
        if (r.measure < policy.measure) {
          skipped.push({ col: p.col, header: p.header, reason: `looks like ${r.role}`, comparable: r.measure });
          continue;
        }
        const domain = extent(p.values, excluded);
        encodings.push({
          kind: "quantitative",
          col: p.col,
          header: p.header,
          polarity: pickPolarity(r.polarity, policy.polarity),
          transform: r.log !== null && r.log >= policy.log && domain[0] > 0 ? "log" : "linear",
          unit: p.unit,
          domain,
          values: p.values,
          group: null,
          evidence: { comparable: r.measure, polarity: r.polarity, log: r.log, orderConfidence: null },
        });
        samples.set(p.col, p.samples);
        units.set(p.col, p.unit);
      } else {
        const p = plan.profile;
        const r = plan.read(plan.answers);
        const { order, confidence } = orderFromPairs(p.levels, r.lower);
        const ordered =
          (r.ordinal >= policy.ordinal && confidence >= policy.orderConfidence) ||
          (r.ordinal >= policy.ordinalWithStrongOrder && confidence >= policy.strongOrder);
        if (!ordered) {
          skipped.push({
            col: p.col,
            header: p.header,
            reason: r.ordinal < policy.ordinalWithStrongOrder ? `labels look like ${r.relation.replaceAll("_", " ")}` : "order is uncertain",
            comparable: r.ordinal,
          });
          continue;
        }
        encodings.push({
          kind: "ordinal",
          col: p.col,
          header: p.header,
          polarity: pickPolarity(r.polarity, policy.polarity),
          order,
          labels: order.map((l) => p.display[l] ?? l),
          values: p.values,
          group: null,
          evidence: { comparable: r.ordinal, polarity: r.polarity, log: null, orderConfidence: confidence },
        });
        samples.set(p.col, order.map((l) => p.display[l] ?? l));
      }
    }
    encodings.sort((a, b) => a.col - b.col);
    const planned: Planned = {
      table,
      judgment: {
        id: table.id,
        orientation: "columns",
        rowsScore: null,
        encodings,
        skipped: skipped.sort((a, b) => a.col - b.col),
        aggregateRows,
      },
      samples,
      units,
    };
    return { planned, rowsScore: orientation?.read(answers) ?? null };
  });

/**
 * One table in its natural orientation. Without an override, the orientation
 * question rides along in the column pass; if the model says rows, the table
 * is judged again transposed.
 */
const judgeTable = (page: PageSnapshot, table: TableSnapshot, policy: Policy, forced?: Orientation) =>
  Effect.gen(function* () {
    if (forced === "rows" && table.rows.length <= MAX_TRANSPOSE_ROWS) {
      const { planned } = yield* judgeColumns(page, transposeSnapshot(table), policy, false);
      return { ...planned, judgment: { ...planned.judgment, orientation: "rows" as const } } satisfies Planned;
    }
    const { planned, rowsScore } = yield* judgeColumns(page, table, policy, forced === undefined);
    if (rowsScore !== null && rowsScore >= policy.rows && table.rows.length <= MAX_TRANSPOSE_ROWS) {
      const rows = yield* judgeColumns(page, transposeSnapshot(table), policy, false);
      return { ...rows.planned, judgment: { ...rows.planned.judgment, orientation: "rows" as const, rowsScore } } satisfies Planned;
    }
    return { ...planned, judgment: { ...planned.judgment, rowsScore } } satisfies Planned;
  });

// ── Cross-table sharing ─────────────────────────────────────────────────────

interface GroupCandidate {
  readonly key: string;
  readonly kind: ColumnEncoding["kind"];
  readonly members: readonly { readonly planned: Planned; readonly encoding: ColumnEncoding }[];
}

const groupKey = (planned: Planned, e: ColumnEncoding): string =>
  `${e.kind}|${normalizeLabel(e.header).replace(/[^a-z0-9%$]+/g, " ").trim()}|${
    planned.units.get(e.col) ?? ""
  }`;

/** Same header (normalized), same kind, same unit, in two or more tables. */
const findGroups = (planned: readonly Planned[]): GroupCandidate[] => {
  const byKey = new Map<string, { planned: Planned; encoding: ColumnEncoding }[]>();
  for (const p of planned) {
    for (const e of p.judgment.encodings) {
      const key = groupKey(p, e);
      byKey.set(key, [...(byKey.get(key) ?? []), { planned: p, encoding: e }]);
    }
  }
  return [...byKey.entries()]
    .filter(([, members]) => new Set(members.map((m) => m.planned.table.id)).size >= 2)
    .map(([key, members]) => ({ key, kind: members[0]!.encoding.kind, members }));
};

const shareAcrossTables = (page: PageSnapshot, planned: readonly Planned[], policy: Policy) =>
  Effect.gen(function* () {
    const groups = findGroups(planned);
    if (groups.length === 0) return planned;
    const model = yield* DecisionModel;

    const questions: Record<string, Question> = {};
    const unions = new Map<string, { labels: string[]; read: (a: Answers) => (i: number, j: number) => number }>();
    groups.forEach((g, gi) => {
      questions[`g${gi}.share`] = shareQuestion(
        g.kind,
        g.members.map((m) => ({
          table: m.planned.table.title,
          header: m.encoding.header,
          unit: m.planned.units.get(m.encoding.col) ?? null,
          examples: m.planned.samples.get(m.encoding.col) ?? [],
        })),
      );
      if (g.kind === "ordinal") {
        // Speculative: only consumed if the group is shared and tables disagree on levels.
        const labels = [
          ...new Set(g.members.flatMap((m) => (m.encoding.kind === "ordinal" ? m.encoding.order : []))),
        ];
        if (labels.length > MAX_UNION_LEVELS) return;
        const pq = pairQuestions(`g${gi}`, `the column "${g.members[0]!.encoding.header}"`, labels);
        Object.assign(questions, pq.questions);
        unions.set(g.key, { labels, read: pq.read });
      }
    });

    const response = yield* model.evaluate({ state: { page_title: page.title }, questions });
    const replacements = new Map<ColumnEncoding, ColumnEncoding>();
    groups.forEach((g, gi) => {
      if (noul(response.answers, `g${gi}.share`) < policy.share) return;
      const id = `shared:${gi}`;
      if (g.kind === "quantitative") {
        const qs = g.members.map((m) => m.encoding).filter((e) => e.kind === "quantitative");
        const domain: [number, number] = [
          Math.min(...qs.map((e) => e.domain[0])),
          Math.max(...qs.map((e) => e.domain[1])),
        ];
        // One transform for the whole group, by majority; mixed scales would defeat the comparison.
        const logVotes = qs.filter((e) => e.transform === "log").length;
        const transform = logVotes * 2 >= qs.length && domain[0] > 0 ? "log" : "linear";
        for (const e of qs) replacements.set(e, { ...e, domain, transform, group: id });
      } else {
        const union = unions.get(g.key);
        const os = g.members.map((m) => m.encoding).filter((e) => e.kind === "ordinal");
        const largest = os.reduce((a, b) => (b.order.length > a.order.length ? b : a));
        const order =
          union !== undefined && union.labels.length > largest.order.length
            ? orderFromPairs(union.labels, union.read(response.answers)).order
            : largest.order;
        const display = new Map(os.flatMap((e) => e.order.map((l, i) => [l, e.labels[i] ?? l] as const)));
        const labels = order.map((l) => display.get(l) ?? l);
        for (const e of os) replacements.set(e, { ...e, order, labels, group: id });
      }
    });

    return planned.map((p) => ({
      ...p,
      judgment: { ...p.judgment, encodings: p.judgment.encodings.map((e) => replacements.get(e) ?? e) },
    }));
  });

/**
 * Two-level ordinals (GA / Preview, Default / Long context, AL / NL) carry one
 * bit the text already shows, and they are where the model's ordinal calls are
 * least stable. Applied after sharing, so a two-level column that joined a
 * wider shared scale keeps its color.
 */
const MIN_ORDINAL_LEVELS = 3;

const dropBinaryOrdinals = (j: TableJudgment): TableJudgment => {
  const binary = j.encodings.filter((e) => e.kind === "ordinal" && e.order.length < MIN_ORDINAL_LEVELS);
  if (binary.length === 0) return j;
  return {
    ...j,
    encodings: j.encodings.filter((e) => !binary.includes(e)),
    skipped: [
      ...j.skipped,
      ...binary.map((e) => ({ col: e.col, header: e.header, reason: "only two levels", comparable: e.evidence.comparable })),
    ].sort((a, b) => a.col - b.col),
  };
};

// ── Entry point ─────────────────────────────────────────────────────────────

export const judgePage = (
  page: PageSnapshot,
  policy: Policy = DEFAULT_POLICY,
  /** Per-table orientation chosen by the reader; skips the orientation question. */
  orientations: Readonly<Record<string, Orientation>> = {},
) =>
  Effect.gen(function* () {
    const model = yield* DecisionModel;
    const tables = page.tables.filter((t) => t.rows.length >= MIN_ROWS && t.headers.length >= 2);
    // Wrap the model once so every request below is counted for the usage report.
    let inputTokens = 0;
    let requests = 0;
    const counted = DecisionModel.of({
      name: model.name,
      evaluate: (req) =>
        model.evaluate(req).pipe(
          Effect.tap((r) =>
            Effect.sync(() => {
              inputTokens += r.usage.input_tokens;
              requests += 1;
            }),
          ),
        ),
    });
    // Each table succeeds or fails on its own; one failed request must not discard
    // every other table's results (including cache hits).
    const results = yield* Effect.forEach(tables, (t) => Effect.result(judgeTable(page, t, policy, orientations[t.id])), {
      concurrency: 6,
    }).pipe(Effect.provideService(DecisionModel, counted));
    const planned = results.flatMap((r) => (r._tag === "Success" ? [r.success] : []));
    const failed = results.flatMap((r, i) =>
      r._tag === "Failure" ? [{ id: tables[i]!.id, reason: r.failure.reason, message: r.failure.message }] : [],
    );
    // Nothing judged at all: surface the error instead of an empty success.
    if (planned.length === 0 && failed.length > 0) {
      return yield* new DecisionError({ reason: failed[0]!.reason, message: failed[0]!.message });
    }
    // Shared scales are a refinement: if that request fails, keep each table's own scale.
    const shared = yield* shareAcrossTables(page, planned, policy).pipe(
      Effect.provideService(DecisionModel, counted),
      Effect.orElseSucceed(() => planned),
    );
    return {
      url: page.url,
      model: model.name,
      tables: shared.map((p) => dropBinaryOrdinals(p.judgment)),
      failed: failed.map(({ id, reason }) => ({ id, reason })),
      usage: { inputTokens, requests },
    } satisfies PageJudgment;
  });
