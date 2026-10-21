/**
 * Checks what the hosted endpoint accepts. The endpoint forwards only the
 * questions that the extension asks. Each question must match a reference
 * question from the extension's own builders in src/decide/questions.ts.
 * Column headers, labels, and table data are the only free parts. The table
 * data and the state must have the shapes that the builders produce, and
 * their strings and lists are clipped to size limits. The endpoint refuses
 * everything else, so it cannot serve as a general-purpose model.
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
  /** Strings in the state and in table-data fields are clipped to this many characters. */
  text: 2000,
  /** Lists and rows in the state and in table-data fields are cut to this many items. */
  items: 200,
  /** The most state and table data in one request together, in bytes of JSON, after clipping. */
  dataBytes: 64 * 1024,
  /** Limits on the table sent to /v1/judge. */
  columns: 60,
  rows: 2000,
  cell: 300,
} as const;

/**
 * The string lengths that `readRequest` tries in turn, until the state and
 * table data fit in `LIMITS.dataBytes`.
 */
const CLIP_STEPS = [LIMITS.text, 500, 100, 20] as const;

/** Marks inserted text, such as a header or a label, in a reference question. */
const HOLE = "\u0001";
/** Marks a column index in `columns[k]`. */
const INDEX = 7_654_321;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternOf = (s: string) =>
  new RegExp(`^${escape(s).replaceAll(HOLE, `[\\s\\S]{0,${LIMITS.hole}}`).replaceAll(String(INDEX), "\\d{1,4}")}$`);

/** Returned by a parser for a value with the wrong shape. */
const FAIL: unique symbol = Symbol("fail");

/**
 * Checks a value's shape and returns the value to forward, or FAIL. Table
 * data comes back with each string clipped to `clip` characters and long
 * lists cut. Question text comes back unchanged.
 */
type Parser = (value: unknown, clip: number) => unknown;

const jsonBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v) ?? "").byteLength;

// ── Shapes of table data ────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text: Parser = (v, clip) => (typeof v === "string" ? v.slice(0, clip) : FAIL);
const literal =
  (value: string): Parser =>
  (v) =>
    v === value ? v : FAIL;
const nullable =
  (p: Parser): Parser =>
  (v, clip) =>
    v === null ? null : p(v, clip);
const anyOf =
  (...ps: readonly Parser[]): Parser =>
  (v, clip) => {
    for (const p of ps) {
      const out = p(v, clip);
      if (out !== FAIL) return out;
    }
    return FAIL;
  };
/** A list cut to `LIMITS.items`. */
const list =
  (item: Parser): Parser =>
  (v, clip) => {
    if (!Array.isArray(v)) return FAIL;
    const out = v.slice(0, LIMITS.items).map((x) => item(x, clip));
    return out.includes(FAIL) ? FAIL : out;
  };
/** A list that is refused, not cut, past `LIMITS.items`, because questions point into it by index. */
const indexedList =
  (item: Parser): Parser =>
  (v, clip) =>
    Array.isArray(v) && v.length > LIMITS.items ? FAIL : list(item)(v, clip);
/** An object with exactly the `required` keys, plus any of the `optional` keys. */
const shape = (required: Readonly<Record<string, Parser>>, optional: Readonly<Record<string, Parser>> = {}): Parser => {
  const fields = new Map([...Object.entries(optional), ...Object.entries(required)]);
  return (v, clip) => {
    if (!isRecord(v) || !Object.keys(required).every((k) => Object.hasOwn(v, k))) return FAIL;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const parse = fields.get(k);
      const parsed = parse === undefined ? FAIL : parse(x, clip);
      if (parsed === FAIL) return FAIL;
      out[k] = parsed;
    }
    return out;
  };
};
/** A table row as `aggregateQuestions` sends it, from header to cell text. */
const row: Parser = (v, clip) => {
  if (!isRecord(v)) return FAIL;
  const entries = Object.entries(v).slice(0, LIMITS.items);
  if (!entries.every(([, x]) => typeof x === "string")) return FAIL;
  return Object.fromEntries(entries.map(([k, x]) => [k.slice(0, clip), (x as string).slice(0, clip)]));
};

/** A column as `describeColumn` in questions.ts describes it. */
const column = anyOf(
  shape(
    { header: text, kind: literal("number"), examples: list(text), spread: text },
    { unit: text, notes: list(text) },
  ),
  shape({ header: text, kind: literal("label"), values: list(text) }),
);

/** The states that `tableState`, `categoricalState`, and `shareAcrossTables` build. */
const state = anyOf(
  shape(
    { page_title: text, table_title: nullable(text), columns: indexedList(column) },
    { rows_are: shape({ header: text, examples: list(text) }) },
  ),
  shape({ page_title: text, table_title: nullable(text), column, other_columns: list(text) }),
  shape({ page_title: text }),
);

/** A group member as `shareQuestion` describes it. */
const member = (values: "examples" | "grades") =>
  shape({ table: nullable(text), header: text, [values]: list(text) }, { unit: text });

/**
 * Builds a parser for a reference value. A function is already a parser. A
 * string that contains HOLE or INDEX becomes a pattern. Arrays match element
 * by element, and objects match key by key with no extra keys.
 */
const compile = (ref: unknown): Parser => {
  if (typeof ref === "function") return ref as Parser;
  if (typeof ref === "string") {
    if (!ref.includes(HOLE) && !ref.includes(String(INDEX))) return (v) => (v === ref ? v : FAIL);
    const re = patternOf(ref);
    return (v) => (typeof v === "string" && re.test(v) ? v : FAIL);
  }
  if (Array.isArray(ref)) {
    const items = ref.map(compile);
    return (v, clip) => {
      if (!Array.isArray(v) || v.length !== items.length) return FAIL;
      const out = items.map((p, i) => p(v[i], clip));
      return out.includes(FAIL) ? FAIL : out;
    };
  }
  if (typeof ref === "object" && ref !== null) {
    const fields = Object.fromEntries(Object.entries(ref).map(([k, r]) => [k, compile(r)]));
    return shape(fields);
  }
  return (v) => (v === ref ? v : FAIL);
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

/** Replaces the table-data fields of a structured instruction with parsers for their shapes. */
const withData = (q: Question, fields: Readonly<Record<string, Parser>>): Question => ({
  ...q,
  instructions: { ...(q.instructions as Record<string, unknown>), ...fields },
});

/** The instruction fields that carry table data. `readRequest` counts their size. */
const DATA_FIELDS = ["row", "first_column", "columns"] as const;

const dataBytes = (q: Question): number => {
  const instructions = q.instructions;
  if (!isRecord(instructions)) return 0;
  return DATA_FIELDS.reduce((n, f) => n + (Object.hasOwn(instructions, f) ? jsonBytes(instructions[f]) : 0), 0);
};

/** Maps a question id pattern to the references that a question with that id may match. */
const RULES: readonly (readonly [RegExp, readonly Parser[]])[] = [
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

/** A /v1/systemone body that `readRequest` accepted, with its table data clipped. */
export interface Accepted {
  readonly state: unknown;
  readonly questions: Readonly<Record<string, Question>>;
}

/** Why `readRequest` refused a body. `error` is the code in the refusal. */
export interface Refused {
  readonly error: "state" | "questions" | "data";
  readonly message: string;
}

const parseQuestions = (questions: unknown, clip: number): Refused | { questions: Record<string, Question> } => {
  const refuse = (message: string): Refused => ({ error: "questions", message });
  if (!isRecord(questions)) return refuse("questions must be an object");
  const entries = Object.entries(questions);
  if (entries.length === 0) return refuse("no questions");
  if (entries.length > LIMITS.questions) return refuse(`more than ${LIMITS.questions} questions`);
  const out: Record<string, Question> = {};
  for (const [id, q] of entries) {
    const rule = RULES.find(([re]) => re.test(id));
    if (rule === undefined) return refuse(`unknown question id ${JSON.stringify(id.slice(0, 40))}`);
    const parsed = anyOf(...rule[1])(q, clip);
    if (parsed === FAIL) return refuse(`question ${id} doesn't match the extension's wording`);
    out[id] = parsed as Question;
  }
  return { questions: out };
};

/**
 * Reads the body of a /v1/systemone request. The state must have a shape
 * that the extension builds, and every question must be one that the
 * extension asks. Returns the body to forward, with long strings in the
 * state and table data clipped and long lists cut. Clipping gets shorter
 * until the state and table data fit in `LIMITS.dataBytes`. Returns a
 * `Refused` for a wrong shape, an unknown question, or data that does not
 * fit even at the shortest clip.
 */
export const readRequest = (body: unknown): Accepted | Refused => {
  const { state: s, questions: q } = isRecord(body) ? body : {};
  for (const clip of CLIP_STEPS) {
    const parsedState = state(s, clip);
    if (parsedState === FAIL) return { error: "state", message: "state doesn't match the extension's shape" };
    const parsed = parseQuestions(q, clip);
    if ("error" in parsed) return parsed;
    const { questions } = parsed;
    const size = Object.values(questions).reduce((n, x) => n + dataBytes(x), jsonBytes(parsedState));
    if (size <= LIMITS.dataBytes) return { state: parsedState, questions };
  }
  return { error: "data", message: `state and table data over ${LIMITS.dataBytes} bytes` };
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
