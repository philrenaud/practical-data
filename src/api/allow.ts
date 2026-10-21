/**
 * Which requests the hosted endpoint forwards: only questions the extension
 * itself asks. Each incoming question must match a reference built by the
 * extension's own question builders (questions.ts), with column headers,
 * labels and sample data as the only free parts. Anything else is refused,
 * so the endpoint can't be used as a general-purpose model.
 *
 * Built from the builders rather than copied text, so changing a question's
 * wording in questions.ts changes what the server accepts in the same commit.
 */
import type { CategoricalProfile, NumericProfile } from "../core/profile.ts";
import type { PageSnapshot } from "../core/types.ts";
import type { Question } from "../decide/model.ts";
import {
  aggregateQuestions,
  categoricalQuestions,
  numericQuestions,
  orientationQuestion,
  pairQuestions,
  shareQuestion,
} from "../decide/questions.ts";

/** Limits on one request. The extension's largest real request is well inside these. */
export const LIMITS = {
  bodyBytes: 256 * 1024,
  questions: 200,
  /** A header, label or reference interpolated into a question. */
  hole: 300,
  /** A whole table sent to /v1/judge. */
  columns: 60,
  rows: 2000,
  cell: 300,
} as const;

/** Stands in for interpolated text (a header, a label) in a reference question. */
const HOLE = "\u0001";
/** Stands in for a column index in `columns[k]`. */
const INDEX = 7_654_321;
/** Marks a field that carries table data rather than question text: any JSON value. */
const DATA = "\u0002";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternOf = (s: string) =>
  new RegExp(`^${escape(s).replaceAll(HOLE, `[\\s\\S]{0,${LIMITS.hole}}`).replaceAll(String(INDEX), "\\d{1,4}")}$`);

type Matcher = (value: unknown) => boolean;

/** Compiles a reference value: strings become patterns, DATA accepts anything, objects match key for key. */
const compile = (ref: unknown): Matcher => {
  if (ref === DATA) return () => true;
  if (typeof ref === "string") {
    if (!ref.includes(HOLE) && !ref.includes(String(INDEX))) return (v) => v === ref;
    const re = patternOf(ref);
    return (v) => typeof v === "string" && re.test(v);
  }
  if (Array.isArray(ref)) {
    const items = ref.map(compile);
    return (v) => Array.isArray(v) && v.length === items.length && items.every((m, i) => m(v[i]));
  }
  if (typeof ref === "object" && ref !== null) {
    const fields = Object.entries(ref).map(([k, r]) => [k, compile(r)] as const);
    const keys = new Set(fields.map(([k]) => k));
    return (v) =>
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      Object.keys(v).length === keys.size &&
      Object.keys(v).every((k) => keys.has(k)) &&
      fields.every(([k, m]) => m((v as Record<string, unknown>)[k]));
  }
  return (v) => v === ref;
};

// ── References ──────────────────────────────────────────────────────────────

const numeric = { kind: "numeric", col: 0, header: HOLE, decades: 3 } as unknown as NumericProfile;
const categorical = {
  kind: "categorical",
  col: 0,
  header: HOLE,
  levels: [],
  display: {},
} as unknown as CategoricalProfile;
const numericRefs = numericQuestions(INDEX, numeric).questions;
const categoricalRefs = categoricalQuestions(categorical).questions;
const pairRef = pairQuestions("p", HOLE, [HOLE, HOLE]).questions["p.lt0_1"]!;
const aggregateRef = aggregateQuestions(
  ["h"],
  Array.from({ length: 5 }, () => ["v"]),
).questions["row0.aggregate"]!;
const orientationRef = orientationQuestion({ header: HOLE, examples: [] }).questions["table.orientation"]!;

/** Replaces the data-carrying parts of a structured instruction with DATA. */
const withData = (q: Question, fields: readonly string[]): Question => ({
  ...q,
  instructions: { ...(q.instructions as Record<string, unknown>), ...Object.fromEntries(fields.map((f) => [f, DATA])) },
});

/** Question id pattern → the references a question with that id may match. */
const RULES: readonly (readonly [RegExp, readonly Matcher[]])[] = [
  [/^n\d{1,4}\.role$/, [compile(numericRefs["n0.role"])]],
  [/^n\d{1,4}\.polarity$/, [compile(numericRefs["n0.polarity"])]],
  [/^n\d{1,4}\.log$/, [compile(numericRefs["n0.log"])]],
  [/^c\d{1,4}\.relation$/, [compile(categoricalRefs["c0.relation"])]],
  [/^c\d{1,4}\.polarity$/, [compile(categoricalRefs["c0.polarity"])]],
  [/^[cg]\d{1,4}\.lt\d{1,3}_\d{1,3}$/, [compile(pairRef)]],
  [/^row\d{1,5}\.aggregate$/, [compile(withData(aggregateRef, ["row"]))]],
  [/^table\.orientation$/, [compile(withData(orientationRef, ["first_column"]))]],
  [
    /^g\d{1,3}\.share$/,
    [
      compile(withData(shareQuestion("quantitative", []), ["columns"])),
      compile(withData(shareQuestion("ordinal", []), ["columns"])),
    ],
  ],
];

/** Null when every question is one the extension asks; otherwise why not. */
export const checkQuestions = (questions: unknown): string | null => {
  if (typeof questions !== "object" || questions === null || Array.isArray(questions))
    return "questions must be an object";
  const entries = Object.entries(questions);
  if (entries.length === 0) return "no questions";
  if (entries.length > LIMITS.questions) return `more than ${LIMITS.questions} questions`;
  for (const [id, q] of entries) {
    const rule = RULES.find(([re]) => re.test(id));
    if (rule === undefined) return `unknown question id ${JSON.stringify(id.slice(0, 40))}`;
    if (!rule[1].some((m) => m(q))) return `question ${id} doesn't match the extension's wording`;
  }
  return null;
};

/**
 * Parses a request body as JSON. Throws a RangeError past `LIMITS.bodyBytes`
 * bytes, and stops reading at that point even when the body has no
 * Content-Length.
 */
export const readBody = async (request: Request): Promise<unknown> => {
  const tooLarge = () => new RangeError(`body over ${LIMITS.bodyBytes} bytes`);
  if (Number(request.headers.get("content-length") ?? "0") > LIMITS.bodyBytes) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  while (reader !== undefined) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.bodyBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  chunks.reduce((offset, c) => (bytes.set(c, offset), offset + c.byteLength), 0);
  return JSON.parse(new TextDecoder().decode(bytes));
};

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

/**
 * The body of a /v1/judge request, `{ title, table: { title, headers, rows } }`,
 * as a one-table page; or why it was refused.
 */
export const readJudgeBody = (body: unknown): PageSnapshot | string => {
  if (typeof body !== "object" || body === null) return "expected { title, table }";
  const { title, table } = body as { title?: unknown; table?: unknown };
  if (title !== undefined && !isText(title, LIMITS.hole)) return `title: at most ${LIMITS.hole} characters`;
  if (typeof table !== "object" || table === null) return "table: expected { title, headers, rows }";
  const t = table as { title?: unknown; headers?: unknown; rows?: unknown };
  if (t.title !== undefined && t.title !== null && !isText(t.title, LIMITS.hole))
    return `table.title: at most ${LIMITS.hole} characters`;
  if (!Array.isArray(t.headers) || t.headers.length === 0 || t.headers.length > LIMITS.columns) {
    return `table.headers: 1 to ${LIMITS.columns} headers`;
  }
  if (!t.headers.every((h) => isText(h, LIMITS.hole)))
    return `table.headers: text of at most ${LIMITS.hole} characters`;
  const width = t.headers.length;
  if (!Array.isArray(t.rows) || t.rows.length > LIMITS.rows) return `table.rows: at most ${LIMITS.rows} rows`;
  for (const row of t.rows as unknown[]) {
    if (!Array.isArray(row) || row.length !== width || !row.every((c) => isText(c, LIMITS.cell))) {
      return `table.rows: each row is ${width} cells of at most ${LIMITS.cell} characters`;
    }
  }
  return {
    url: "",
    title: title ?? "",
    tables: [
      {
        id: "t0",
        title: (t.title as string | null | undefined) ?? null,
        headers: t.headers as string[],
        rows: t.rows as string[][],
      },
    ],
  };
};
