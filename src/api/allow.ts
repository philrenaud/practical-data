/**
 * Checks what the hosted endpoint accepts. The endpoint forwards only the
 * questions that the extension asks. Each question must match a reference
 * question from the extension's own builders in src/decide/questions.ts.
 * Column headers, labels, and table data are the only free parts. The table
 * data and the state must have the shapes that the builders produce, within
 * size limits. The endpoint refuses everything else, so it cannot serve as a
 * general-purpose model.
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

/**
 * Size limits on one request. The extension's largest real requests are well
 * inside them. In the eval pages, the largest state is about 4 KB and the
 * most table data in one request is about 7 KB.
 */
export const LIMITS = {
  bodyBytes: 256 * 1024,
  questions: 200,
  /** The longest header, label, or other text inserted into a question. */
  hole: 300,
  /** The longest string in the state or in a table-data field. */
  text: 2000,
  /** The most items in a list or keys in a row, in the state or in a table-data field. */
  items: 200,
  /** The largest state, in bytes of JSON. */
  stateBytes: 32 * 1024,
  /** The largest table-data field in one question, in bytes of JSON. */
  fieldBytes: 16 * 1024,
  /** The most state and table data in one request together, in bytes of JSON. */
  dataBytes: 64 * 1024,
  /** Limits on the table sent to /v1/judge. */
  columns: 60,
  rows: 2000,
  cell: 300,
} as const;

/** Marks inserted text, such as a header or a label, in a reference question. */
const HOLE = "\u0001";
/** Marks a column index in `columns[k]`. */
const INDEX = 7_654_321;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternOf = (s: string) =>
  new RegExp(`^${escape(s).replaceAll(HOLE, `[\\s\\S]{0,${LIMITS.hole}}`).replaceAll(String(INDEX), "\\d{1,4}")}$`);

type Matcher = (value: unknown) => boolean;

const jsonBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v) ?? "").byteLength;

// ── Shapes of table data ────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text: Matcher = (v) => typeof v === "string" && v.length <= LIMITS.text;
const literal =
  (value: string): Matcher =>
  (v) =>
    v === value;
const nullable =
  (m: Matcher): Matcher =>
  (v) =>
    v === null || m(v);
const anyOf =
  (...ms: readonly Matcher[]): Matcher =>
  (v) =>
    ms.some((m) => m(v));
const list =
  (item: Matcher, max: number = LIMITS.items): Matcher =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(item);
/** An object with exactly the `required` keys, plus any of the `optional` keys. */
const shape = (
  required: Readonly<Record<string, Matcher>>,
  optional: Readonly<Record<string, Matcher>> = {},
): Matcher => {
  const fields = new Map([...Object.entries(optional), ...Object.entries(required)]);
  return (v) =>
    isRecord(v) &&
    Object.keys(required).every((k) => Object.hasOwn(v, k)) &&
    Object.entries(v).every(([k, x]) => fields.get(k)?.(x) === true);
};
/** A table row as `aggregateQuestions` sends it: header to cell text. */
const row: Matcher = (v) =>
  isRecord(v) && Object.keys(v).length <= LIMITS.items && Object.entries(v).every(([k, x]) => text(k) && text(x));
const sized =
  (m: Matcher, maxBytes: number): Matcher =>
  (v) =>
    m(v) && jsonBytes(v) <= maxBytes;

/** A column as `describeColumn` in questions.ts describes it. */
const column = anyOf(
  shape(
    { header: text, kind: literal("number"), examples: list(text), spread: text },
    { unit: text, notes: list(text) },
  ),
  shape({ header: text, kind: literal("label"), values: list(text) }),
);

/** The states that `tableState`, `categoricalState`, and `shareAcrossTables` build. */
const state = sized(
  anyOf(
    shape(
      { page_title: text, table_title: nullable(text), columns: list(column) },
      { rows_are: shape({ header: text, examples: list(text) }) },
    ),
    shape({ page_title: text, table_title: nullable(text), column, other_columns: list(text) }),
    shape({ page_title: text }),
  ),
  LIMITS.stateBytes,
);

/** A group member as `shareQuestion` describes it. */
const member = (values: "examples" | "grades") =>
  shape({ table: nullable(text), header: text, [values]: list(text) }, { unit: text });

/**
 * Builds a matcher for a reference value. A function is already a matcher. A
 * string that contains HOLE or INDEX becomes a pattern. Arrays match element
 * by element, and objects match key by key with no extra keys.
 */
const compile = (ref: unknown): Matcher => {
  if (typeof ref === "function") return ref as Matcher;
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

/** Replaces the table-data fields of a structured instruction with matchers for their shapes. */
const withData = (q: Question, fields: Readonly<Record<string, Matcher>>): Question => ({
  ...q,
  instructions: {
    ...(q.instructions as Record<string, unknown>),
    ...Object.fromEntries(Object.entries(fields).map(([f, m]) => [f, sized(m, LIMITS.fieldBytes)])),
  },
});

/** The instruction fields that carry table data. `checkRequest` counts their size. */
const DATA_FIELDS = ["row", "first_column", "columns"] as const;

const dataBytes = (q: Question): number => {
  const instructions = q.instructions;
  if (!isRecord(instructions)) return 0;
  return DATA_FIELDS.reduce((n, f) => n + (Object.hasOwn(instructions, f) ? jsonBytes(instructions[f]) : 0), 0);
};

/** Maps a question id pattern to the references that a question with that id may match. */
const RULES: readonly (readonly [RegExp, readonly Matcher[]])[] = [
  [/^n\d{1,4}\.role$/, [compile(numericRefs["n0.role"])]],
  [/^n\d{1,4}\.polarity$/, [compile(numericRefs["n0.polarity"])]],
  [/^n\d{1,4}\.log$/, [compile(numericRefs["n0.log"])]],
  [/^c\d{1,4}\.relation$/, [compile(categoricalRefs["c0.relation"])]],
  [/^c\d{1,4}\.polarity$/, [compile(categoricalRefs["c0.polarity"])]],
  [/^[cg]\d{1,4}\.lt\d{1,3}_\d{1,3}$/, [compile(pairRef)]],
  [/^row\d{1,5}\.aggregate$/, [compile(withData(aggregateRef, { row }))]],
  [
    /^table\.orientation$/,
    [compile(withData(orientationRef, { first_column: shape({ header: text, examples: list(text) }) }))],
  ],
  [
    /^g\d{1,3}\.share$/,
    [
      compile(withData(shareQuestion("quantitative", []), { columns: list(member("examples")) })),
      compile(withData(shareQuestion("ordinal", []), { columns: list(member("grades")) })),
    ],
  ],
];

/** Returns null when every question is one that the extension asks. Otherwise returns the reason for the refusal. */
export const checkQuestions = (questions: unknown): string | null => {
  if (!isRecord(questions)) return "questions must be an object";
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
 * Checks the body of a /v1/systemone request. Returns null when the state
 * has a shape that the extension builds, every question passes
 * `checkQuestions`, and the state and table data fit in `LIMITS.dataBytes`.
 * Otherwise returns the reason for the refusal.
 */
export const checkRequest = (body: unknown): string | null => {
  const { state: s, questions } = isRecord(body) ? body : {};
  if (!state(s)) return "state doesn't match the extension's shape";
  const problem = checkQuestions(questions);
  if (problem !== null) return problem;
  const data = Object.values(questions as Record<string, Question>).reduce((n, q) => n + dataBytes(q), jsonBytes(s));
  return data > LIMITS.dataBytes ? `state and table data over ${LIMITS.dataBytes} bytes` : null;
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
