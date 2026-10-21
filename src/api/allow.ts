/**
 * Checks what the hosted endpoint accepts. The endpoint forwards only the
 * questions that the extension asks. Each question must match a reference
 * question from the extension's own builders in src/decide/questions.ts.
 * Column headers, labels, and table data are the only free parts. The
 * endpoint refuses everything else, so it cannot serve as a general-purpose
 * model.
 *
 * The references come from the builders, not from copied text. A wording
 * change in questions.ts therefore changes what the server accepts in the
 * same commit.
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

/** Size limits on one request. The extension's largest real requests are well inside them. */
export const LIMITS = {
  bodyBytes: 256 * 1024,
  questions: 200,
  /** The longest header, label, or other text inserted into a question. */
  hole: 300,
  /** Limits on the table sent to /v1/judge. */
  columns: 60,
  rows: 2000,
  cell: 300,
} as const;

/** Marks inserted text, such as a header or a label, in a reference question. */
const HOLE = "\u0001";
/** Marks a column index in `columns[k]`. */
const INDEX = 7_654_321;
/** Marks a field that carries table data instead of question text. The field matches any JSON value. */
const DATA = "\u0002";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternOf = (s: string) =>
  new RegExp(`^${escape(s).replaceAll(HOLE, `[\\s\\S]{0,${LIMITS.hole}}`).replaceAll(String(INDEX), "\\d{1,4}")}$`);

type Matcher = (value: unknown) => boolean;

/**
 * Builds a matcher for a reference value. A string that contains HOLE or
 * INDEX becomes a pattern. DATA matches any value. Arrays match element by
 * element, and objects match key by key with no extra keys.
 */
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

/** Maps a question id pattern to the references that a question with that id may match. */
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

/** Returns null when every question is one that the extension asks. Otherwise returns the reason for the refusal. */
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
 * Reads the body of a /v1/judge request, `{ title, table: { title, headers,
 * rows } }`, as a page with one table. Returns the reason as a string when
 * the body is malformed or too large.
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
