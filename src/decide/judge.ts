/**
 * Turns a `PageSnapshot` into a `PageJudgment`: the color encoding of each
 * column that is worth shading. See README.md in this directory.
 *
 * 1. `profileTable` profiles each table in code.
 * 2. Each table gets one request for its numeric columns and summary rows,
 *    and one request per categorical column. All requests run concurrently.
 * 3. The `read` functions and the `Policy` thresholds turn the answers into
 *    encodings. Code alone encodes date columns.
 * 4. One page request asks whether same-named columns in different tables
 *    share a scale. Shared columns get one domain or one order.
 */
import { orderFromPairs } from "../core/order.ts";
import { isDateUnit, parseDateColumn } from "../core/dates.ts";
import { transposeSnapshot, type Orientation } from "../core/orient.ts";
import type { CategoricalProfile, ColumnProfile, NumericProfile } from "../core/profile.ts";
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
import { mapConcurrent } from "./concurrency.ts";
import { DecisionError, type DecisionModel, type Question } from "./model.ts";
import {
  aggregateQuestions,
  type Answers,
  categoricalQuestions,
  noul,
  numericQuestions,
  pairQuestions,
  shareQuestion,
  categoricalState,
  sumRows,
  orientationQuestion,
  tableState,
} from "./questions.ts";

/**
 * The probability thresholds that turn answers into decisions. The values in
 * `DEFAULT_POLICY` were set by running `npm run eval` against
 * `fixtures/expectations.json`.
 */
export interface Policy {
  /** P(amount) needed to shade a numeric column. */
  readonly measure: number;
  /** P(ordered levels) needed to shade a categorical column. */
  readonly ordinal: number;
  /** Pairwise order agreement needed together with `ordinal`. */
  readonly orderConfidence: number;
  /** P(ratios matter) needed for a log scale. */
  readonly log: number;
  /** P(higher is better) or P(lower is better) needed for a direction. Below it, the scale is neutral. */
  readonly polarity: number;
  /** P(summary row) needed to leave a row out of the domains. */
  readonly aggregate: number;
  /** P(same quantity) needed to put a group of columns on one scale. */
  readonly share: number;
  /** P(values compare across rows) needed to judge a table transposed. */
  readonly rows: number;
  /**
   * A lower P(ordered levels) that still counts when the pairwise answers
   * agree at `strongOrder` or above. Consistent pairwise answers are evidence
   * that the order is real. Lightweight < Versatile < Powerful scores about
   * 0.6 and 0.95. Below this value, the pairwise questions are not sent.
   */
  readonly ordinalWithStrongOrder: number;
  readonly strongOrder: number;
}

/**
 * The shipped thresholds. A column gets color only when the model is at
 * least 0.7 sure that it is comparable. Label columns also need 0.7 for
 * their order. A column with an unsure direction still gets color, on the
 * neutral scale.
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

/** Tables with fewer rows are not judged. */
const MIN_ROWS = 3;
/** The most rows a table can have and still be judged transposed. Each row becomes a column with its own questions. */
export const MAX_TRANSPOSE_ROWS = 40;
/** The most labels in a shared ordinal group for which a merged order is asked. */
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

/**
 * The evidence recorded for a column that code encodes without the model. A
 * date column is always comparable. It has no better direction, because
 * earlier and later are not good and bad.
 */
const CODE_EVIDENCE: ColumnEncoding["evidence"] = {
  comparable: 1,
  polarity: { higher_is_better: 0, lower_is_better: 0, neutral: 1 },
  log: null,
  orderConfidence: null,
};

/** Encodes the date columns from earliest to latest, without the model. */
const dateEncodings = (
  table: TableSnapshot,
  profiles: readonly ColumnProfile[],
  excluded: ReadonlySet<number>,
  now: number,
): ColumnEncoding[] =>
  profiles.flatMap((p) => {
    if (p.kind !== "text" || p.reason !== "dates or times") return [];
    const dates = parseDateColumn(
      table.rows.map((r) => r[p.col] ?? ""),
      now,
    );
    if (dates === null) return [];
    return [
      {
        kind: "quantitative" as const,
        col: p.col,
        header: p.header,
        polarity: "neutral" as const,
        transform: "linear" as const,
        unit: dates.unit,
        domain: extent(dates.values, excluded),
        values: dates.values,
        group: null,
        evidence: CODE_EVIDENCE,
      },
    ];
  });

/** A table's judgment before cross-table sharing, with what the share question needs. */
interface Planned {
  readonly table: TableSnapshot;
  readonly judgment: TableJudgment;
  /** Samples per encoded column, by column index. */
  readonly samples: ReadonlyMap<number, readonly string[]>;
  /** Units per encoded numeric column, by column index. */
  readonly units: ReadonlyMap<number, string | null>;
}

/** Judges one table column by column. With `askOrientation`, the table request also asks the orientation question. */
const judgeColumns = async (
  model: DecisionModel,
  page: PageSnapshot,
  table: TableSnapshot,
  policy: Policy,
  askOrientation: boolean,
  now: number,
) => {
  const profiles = profileTable(table);
  const candidates = profiles.filter(
    (p): p is NumericProfile | CategoricalProfile => p.kind === "numeric" || p.kind === "categorical",
  );
  const skipped: SkippedColumn[] = profiles.flatMap((p) =>
    p.kind === "text" ? [{ col: p.col, header: p.header, reason: p.reason, comparable: null }] : [],
  );
  const unasked = (dates: readonly ColumnEncoding[]): Planned => ({
    table,
    judgment: {
      id: table.id,
      orientation: "columns",
      rowsScore: null,
      encodings: dates,
      skipped: skipped.filter((s) => !dates.some((d) => d.col === s.col)),
      aggregateRows: [],
    },
    samples: new Map(),
    units: new Map(),
  });
  if (table.rows.length < MIN_ROWS) return { planned: unasked([]), rowsScore: null };
  if (candidates.length === 0)
    return { planned: unasked(dateEncodings(table, profiles, new Set(), now)), rowsScore: null };

  const ctx = { page: page.title, table: table.title };
  const numeric = candidates.filter((p) => p.kind === "numeric");
  const numericPlans = numeric.map((p, k) => ({ profile: p, ...numericQuestions(k, p) }));
  const categoricalPlans = candidates
    .filter((p) => p.kind === "categorical")
    .map((p) => ({ profile: p, ...categoricalQuestions(p) }));
  const aggregates = aggregateQuestions(table.headers, table.rows);
  // Orientation only matters when several numeric columns could be read either way.
  const orientation =
    askOrientation && numeric.length >= 2
      ? orientationQuestion({
          header: table.headers[0] ?? "",
          examples: table.rows.slice(0, 5).map((r) => r[0] ?? ""),
        })
      : null;

  // One request covers the numeric columns and the summary rows. Each
  // categorical column gets its own request. All of them run concurrently.
  // The first failure stops the others.
  const [tableAnswers, ...categoricalAnswers] = await mapConcurrent(
    [
      (signal: AbortSignal) =>
        model.evaluate(
          {
            state: tableState(ctx, profiles, numeric),
            questions: Object.assign(
              {},
              aggregates.questions,
              orientation?.questions ?? {},
              ...numericPlans.map((p) => p.questions),
            ),
          },
          signal,
        ),
      ...categoricalPlans.map(({ profile: p, ...q }) => async (signal: AbortSignal) => {
        const state = categoricalState(
          ctx,
          p,
          table.headers.filter((h, i) => i !== p.col && h !== ""),
        );
        const first = await model.evaluate({ state, questions: q.questions }, signal);
        // Send the pairwise order questions only when the labels might be ordered.
        // A column of 12 team names would otherwise send 132 of them.
        if (q.ordinalOf(first.answers) < policy.ordinalWithStrongOrder) return first;
        const pairs = await model.evaluate({ state, questions: q.pairQuestions }, signal);
        return { ...first, answers: { ...first.answers, ...pairs.answers } };
      }),
    ],
    Infinity,
    (ask, signal) => ask(signal),
  );
  const answers = tableAnswers!.answers;
  // A row whose numbers add up to the other rows is a total, whatever the model says about its label.
  const aggregateRows = [
    ...new Set([...aggregates.read(answers, policy.aggregate), ...sumRows(numeric, table.rows.length)]),
  ].sort((a, b) => a - b);
  const excluded = new Set(aggregateRows);
  const plans = [
    ...numericPlans.map((plan) => ({ kind: "numeric" as const, ...plan, answers })),
    ...categoricalPlans.map((plan, i) => ({
      kind: "categorical" as const,
      ...plan,
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
        // Ranks are evenly spaced positions. A log scale would crowd the bottom of the list.
        transform: r.role !== "rank" && r.log !== null && r.log >= policy.log && domain[0] > 0 ? "log" : "linear",
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
          reason:
            r.ordinal < policy.ordinalWithStrongOrder
              ? `labels look like ${r.relation.replaceAll("_", " ")}`
              : "order is uncertain",
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
      samples.set(
        p.col,
        order.map((l) => p.display[l] ?? l),
      );
    }
  }
  const dates = dateEncodings(table, profiles, excluded, now);
  encodings.push(...dates);
  encodings.sort((a, b) => a.col - b.col);
  const planned: Planned = {
    table,
    judgment: {
      id: table.id,
      orientation: "columns",
      rowsScore: null,
      encodings,
      skipped: skipped.filter((s) => !dates.some((d) => d.col === s.col)).sort((a, b) => a.col - b.col),
      aggregateRows,
    },
    samples,
    units,
  };
  return { planned, rowsScore: orientation?.read(answers) ?? null };
};

/**
 * Judges one table. `forced` is the orientation the user chose. Without it,
 * the first pass also asks the orientation question. If P(rows) reaches
 * `Policy.rows`, the table is judged again, transposed. A table with more
 * than `MAX_TRANSPOSE_ROWS` rows is always judged by columns.
 */
const judgeTable = async (
  model: DecisionModel,
  page: PageSnapshot,
  table: TableSnapshot,
  policy: Policy,
  now: number,
  forced?: Orientation,
): Promise<Planned> => {
  if (forced === "rows" && table.rows.length <= MAX_TRANSPOSE_ROWS) {
    const { planned } = await judgeColumns(model, page, transposeSnapshot(table), policy, false, now);
    return { ...planned, judgment: { ...planned.judgment, orientation: "rows" as const } } satisfies Planned;
  }
  const { planned, rowsScore } = await judgeColumns(model, page, table, policy, forced === undefined, now);
  if (rowsScore !== null && rowsScore >= policy.rows && table.rows.length <= MAX_TRANSPOSE_ROWS) {
    const rows = await judgeColumns(model, page, transposeSnapshot(table), policy, false, now);
    return {
      ...rows.planned,
      judgment: { ...rows.planned.judgment, orientation: "rows" as const, rowsScore },
    } satisfies Planned;
  }
  return { ...planned, judgment: { ...planned.judgment, rowsScore } } satisfies Planned;
};

// ── Cross-table sharing ─────────────────────────────────────────────────────

interface GroupCandidate {
  readonly key: string;
  readonly kind: ColumnEncoding["kind"];
  readonly members: readonly { readonly planned: Planned; readonly encoding: ColumnEncoding }[];
}

/** Columns with the same kind, normalized header, and unit get the same key. */
const groupKey = (planned: Planned, e: ColumnEncoding): string =>
  `${e.kind}|${normalizeLabel(e.header)
    .replace(/[^a-z0-9%$]+/g, " ")
    .trim()}|${planned.units.get(e.col) ?? ""}`;

/**
 * The largest ratio between the magnitudes of columns that can share a scale.
 * One header can name totals over different spans, such as home runs in the
 * last five games (0 to 1) and in a season (0 to 62). On one scale, the
 * smaller column would show as one color. Such columns are never offered to
 * the model.
 */
export const MAX_SHARE_RATIO = 10;

type Member = GroupCandidate["members"][number];

const magnitude = (e: ColumnEncoding): number =>
  e.kind === "quantitative" ? Math.max(Math.abs(e.domain[0]), Math.abs(e.domain[1])) : 0;

/**
 * Splits quantitative members into runs by magnitude. Each member is within
 * `MAX_SHARE_RATIO` of the smallest member of its run. Ordinal members stay
 * in one run.
 */
const byMagnitude = (members: readonly Member[]): Member[][] => {
  if (members[0]?.encoding.kind !== "quantitative") return [[...members]];
  const sorted = [...members].sort((a, b) => magnitude(a.encoding) - magnitude(b.encoding));
  const runs: Member[][] = [];
  for (const m of sorted) {
    const run = runs.at(-1);
    const floor = run === undefined ? 0 : magnitude(run[0]!.encoding);
    if (run !== undefined && magnitude(m.encoding) <= Math.max(floor, Number.MIN_VALUE) * MAX_SHARE_RATIO) run.push(m);
    else runs.push([m]);
  }
  // Keep page order within a run. A group that the split leaves whole then sends
  // the same request as before the split, and its recording still matches.
  return runs.map((run) => members.filter((m) => run.includes(m)));
};

/**
 * Finds the columns that may share a scale. Members have the same `groupKey`
 * and a similar magnitude, and come from two or more tables.
 */
const findGroups = (planned: readonly Planned[]): GroupCandidate[] => {
  const byKey = new Map<string, Member[]>();
  for (const p of planned) {
    for (const e of p.judgment.encodings) {
      // Skip dates. The share question is about measures, and code encoded the dates alone.
      if (e.kind === "quantitative" && isDateUnit(e.unit)) continue;
      const key = groupKey(p, e);
      byKey.set(key, [...(byKey.get(key) ?? []), { planned: p, encoding: e }]);
    }
  }
  return [...byKey.entries()]
    .flatMap(([key, members]) =>
      byMagnitude(members).map((run, i) => ({ key: i === 0 ? key : `${key}#${i}`, members: run })),
    )
    .filter(({ members }) => new Set(members.map((m) => m.planned.table.id)).size >= 2)
    .map(({ key, members }) => ({ key, kind: members[0]!.encoding.kind, members }));
};

/**
 * Picks one direction for a shared scale from the mean of the members'
 * polarity probabilities. Without it, one table could read a value as good
 * and another as neutral, and the same value would get two colors.
 */
const sharedPolarity = (members: readonly ColumnEncoding[], policy: Policy): Polarity => {
  const mean = (k: Polarity) => members.reduce((n, e) => n + e.evidence.polarity[k], 0) / members.length;
  return pickPolarity(
    { higher_is_better: mean("higher_is_better"), lower_is_better: mean("lower_is_better"), neutral: mean("neutral") },
    policy.polarity,
  );
};

/**
 * Sends one page request with a share question per group. Each group that
 * the model accepts gets one domain and transform, or one order, and one
 * direction.
 */
const shareAcrossTables = async (
  model: DecisionModel,
  page: PageSnapshot,
  planned: readonly Planned[],
  policy: Policy,
): Promise<readonly Planned[]> => {
  const groups = findGroups(planned);
  if (groups.length === 0) return planned;

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
      // Asked before the share answer is known. The answers are used only when the
      // group is shared and its tables have different labels.
      const labels = [...new Set(g.members.flatMap((m) => (m.encoding.kind === "ordinal" ? m.encoding.order : [])))];
      if (labels.length > MAX_UNION_LEVELS) return;
      const pq = pairQuestions(`g${gi}`, `the column "${g.members[0]!.encoding.header}"`, labels);
      Object.assign(questions, pq.questions);
      unions.set(g.key, { labels, read: pq.read });
    }
  });

  const response = await model.evaluate({ state: { page_title: page.title }, questions });
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
      // One transform for the group: log when at least half the members use log.
      // Mixed transforms would break the comparison.
      const logVotes = qs.filter((e) => e.transform === "log").length;
      const transform = logVotes * 2 >= qs.length && domain[0] > 0 ? "log" : "linear";
      const polarity = sharedPolarity(qs, policy);
      for (const e of qs) replacements.set(e, { ...e, domain, transform, polarity, group: id });
    } else {
      const union = unions.get(g.key);
      const os = g.members.map((m) => m.encoding).filter((e) => e.kind === "ordinal");
      const largest = os.reduce((a, b) => (b.order.length > a.order.length ? b : a));
      const order =
        union !== undefined && union.labels.length > largest.order.length
          ? orderFromPairs(union.labels, union.read(response.answers)).order
          : largest.order;
      // Without a union order, a label outside the largest table's order would lose its color.
      if (!os.every((e) => e.order.every((l) => order.includes(l)))) return;
      const display = new Map(os.flatMap((e) => e.order.map((l, i) => [l, e.labels[i] ?? l] as const)));
      const labels = order.map((l) => display.get(l) ?? l);
      const polarity = sharedPolarity(os, policy);
      for (const e of os) replacements.set(e, { ...e, order, labels, polarity, group: id });
    }
  });

  return planned.map((p) => ({
    ...p,
    judgment: { ...p.judgment, encodings: p.judgment.encodings.map((e) => replacements.get(e) ?? e) },
  }));
};

/**
 * The fewest levels an ordinal column needs to keep its color. Two-level
 * columns such as GA / Preview or AL / NL carry one bit that the text already
 * shows. The model's ordinal calls were also least stable on them.
 */
const MIN_ORDINAL_LEVELS = 3;

/**
 * Moves ordinal encodings with fewer than `MIN_ORDINAL_LEVELS` levels to
 * `skipped`. It runs after sharing, so a two-level column on a wider shared
 * scale keeps its color.
 */
const dropBinaryOrdinals = (j: TableJudgment): TableJudgment => {
  const binary = j.encodings.filter((e) => e.kind === "ordinal" && e.order.length < MIN_ORDINAL_LEVELS);
  if (binary.length === 0) return j;
  return {
    ...j,
    encodings: j.encodings.filter((e) => !binary.includes(e)),
    skipped: [
      ...j.skipped,
      ...binary.map((e) => ({
        col: e.col,
        header: e.header,
        reason: "only two levels",
        comparable: e.evidence.comparable,
      })),
    ].sort((a, b) => a.col - b.col),
  };
};

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Judges every table on `page`. A table whose requests fail is listed in
 * `failed`, and the other tables keep their results. It rejects with a
 * `DecisionError` only when every table fails.
 */
export const judgePage = async (
  model: DecisionModel,
  page: PageSnapshot,
  policy: Policy = DEFAULT_POLICY,
  /** The orientation the user chose, by table id. A table listed here skips the orientation question. */
  orientations: Readonly<Record<string, Orientation>> = {},
  /** The instant that relative dates such as "3 days ago" count back from. */
  now: number = Date.now(),
): Promise<PageJudgment> => {
  const tables = page.tables.filter((t) => t.rows.length >= MIN_ROWS && t.headers.length >= 2);
  // Count each `evaluate` call and its input tokens for `usage`. Cache hits count
  // too, and one call can send several HTTP requests.
  let inputTokens = 0;
  let requests = 0;
  const counted: DecisionModel = {
    name: model.name,
    evaluate: async (req, signal) => {
      const r = await model.evaluate(req, signal);
      inputTokens += r.usage.input_tokens;
      requests += 1;
      return r;
    },
  };
  // Each table succeeds or fails on its own. One failed request does not discard
  // the other tables' results. An error other than a DecisionError is a bug, and rejects.
  const results = await mapConcurrent(tables, 6, (t) =>
    judgeTable(counted, page, t, policy, now, orientations[t.id]).then(
      (success) => ({ ok: true as const, success }),
      (e: unknown) => {
        if (e instanceof DecisionError) return { ok: false as const, failure: e };
        throw e;
      },
    ),
  );
  const planned = results.flatMap((r) => (r.ok ? [r.success] : []));
  const failed = results.flatMap((r, i) =>
    r.ok ? [] : [{ id: tables[i]!.id, reason: r.failure.reason, message: r.failure.message }],
  );
  // If no table was judged, fail with the first error instead of returning an empty judgment.
  if (planned.length === 0 && failed.length > 0) {
    throw new DecisionError({ reason: failed[0]!.reason, message: failed[0]!.message });
  }
  // If the share request fails, each table keeps its own scales.
  const shared = await shareAcrossTables(counted, page, planned, policy).catch((e: unknown) => {
    if (e instanceof DecisionError) return planned;
    throw e;
  });
  return {
    url: page.url,
    model: model.name,
    tables: shared.map((p) => dropBinaryOrdinals(p.judgment)),
    failed: failed.map(({ id, reason }) => ({ id, reason })),
    usage: { inputTokens, requests },
  } satisfies PageJudgment;
};
