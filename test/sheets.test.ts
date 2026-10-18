import { test } from "node:test";
import assert from "node:assert/strict";
import { planFormatting, requestFromRange, type Formatting } from "../src/sheets/plan.ts";
import type { ColumnEncoding, TableJudgment } from "../src/core/types.ts";

const evidence = { comparable: 1, polarity: { higher_is_better: 0, lower_is_better: 1, neutral: 0 }, log: null, orderConfidence: null };

const price: ColumnEncoding = {
  kind: "quantitative", col: 1, header: "Price", polarity: "lower_is_better", transform: "linear", unit: "$",
  domain: [10, 30], values: [10, 20, 30, 60], group: null, evidence,
};
const tier: ColumnEncoding = {
  kind: "ordinal", col: 2, header: "Tier", polarity: "neutral",
  order: ["basic", "pro"], labels: ["Basic", "Pro"], values: ["basic", "pro", "pro", null], group: null, evidence,
};
const judgment = (encodings: ColumnEncoding[], extra: Partial<TableJudgment> = {}): TableJudgment => ({
  id: "t0", orientation: "columns", rowsScore: null, encodings, skipped: [], aggregateRows: [], ...extra,
});

// Header row, three plans, a total row.
const raw = [
  ["Plan", "Price", "Tier"],
  ["A", 10, "Basic"],
  ["B", 20, "Pro"],
  ["C", 30, "Pro"],
  ["Total", 60, ""],
];

test("a range becomes a table: header row first, blank edges dropped, blank headers named by column", () => {
  const { request, rows, cols } = requestFromRange(
    [
      ["Plan", "", "Price", ""],
      ["A", "x", "$10", ""],
      ["B", "y", "$20", ""],
      ["", "", "", ""],
    ],
    "Budget",
    "Q3",
    2,
  );
  assert.equal(rows, 3);
  assert.equal(cols, 3);
  assert.deepEqual(request, {
    title: "Budget",
    table: { title: "Q3", headers: ["Plan", "D", "Price"], rows: [["A", "x", "$10"], ["B", "y", "$20"]] },
  });
});

test("numbers get a color scale over the judged domain, good end where lower is better", () => {
  const [f] = planFormatting(judgment([price], { aggregateRows: [3] }), raw, "calm") as [Extract<Formatting, { kind: "scale" }>];
  assert.equal(f.kind, "scale");
  // Rows 1-3 of column 1; the total row is left out.
  assert.deepEqual(f.blocks, [{ row: 1, col: 1, rows: 3, cols: 1 }]);
  assert.deepEqual([f.min.value, f.mid.value, f.max.value], [10, 20, 30]);
  // Calm fades: the middle stays white, the cheapest end is green, the dearest rose.
  assert.equal(f.mid.color, "#ffffff");
  const [r, g] = [1, 3].map((i) => parseInt(f.min.color.slice(i, i + 2), 16)) as [number, number];
  assert.ok(g > r, `cheapest should be green, got ${f.min.color}`);
});

test("a total row in the middle splits the scale's range around it", () => {
  const [f] = planFormatting(judgment([price], { aggregateRows: [1] }), raw, "calm") as [Extract<Formatting, { kind: "scale" }>];
  assert.deepEqual(f.blocks, [
    { row: 1, col: 1, rows: 1, cols: 1 },
    { row: 3, col: 1, rows: 2, cols: 1 },
  ]);
});

test("percentages: the scale's points are in stored units, as Sheets compares them", () => {
  // Displayed "39%", "42%", "46%"; stored 0.39, 0.42, 0.46.
  const share: ColumnEncoding = { ...price, header: "Resistance", polarity: "neutral", unit: "%", domain: [39, 46], values: [39, 42, 46] };
  const [f] = planFormatting(judgment([share]), [["Ride", "Resistance"], ["a", 0.39], ["b", 0.42], ["c", 0.46]], "calm");
  assert.equal(f!.kind, "scale");
  const { min, mid, max } = f as Extract<Formatting, { kind: "scale" }>;
  assert.deepEqual([min.value, mid.value, max.value].map((v) => Math.round(v * 1000) / 1000), [0.39, 0.425, 0.46]);
});

test("stored values with no single relation to the text are filled instead", () => {
  const odd: ColumnEncoding = { ...price, domain: [1, 3], values: [1, 2, 3] };
  const [f] = planFormatting(judgment([odd]), [["A", "B"], ["a", 1], ["b", 20], ["c", 3]], "calm");
  assert.equal(f!.kind, "fill");
});

test("numbers stored as text are filled cell by cell", () => {
  const asText = raw.map((r) => r.map(String));
  const [f] = planFormatting(judgment([price], { aggregateRows: [3] }), asText, "calm");
  assert.equal(f!.kind, "fill");
  assert.deepEqual((f as Extract<Formatting, { kind: "fill" }>).cells.map((c) => [c.row, c.col]), [[1, 1], [2, 1], [3, 1]]);
});

test("ordered labels get one color per level, as written", () => {
  const [f] = planFormatting(judgment([tier]), raw, "calm") as [Extract<Formatting, { kind: "levels" }>];
  assert.equal(f.kind, "levels");
  assert.deepEqual(f.levels.map((l) => l.text), ["Basic", "Pro"]);
  assert.notEqual(f.levels[0]!.color, f.levels[1]!.color);
  assert.deepEqual(f.blocks, [{ row: 1, col: 2, rows: 3, cols: 1 }]);
});

test("row-oriented tables shade across rows", () => {
  // Benchmarks as rows, models as columns: encoding column 2 is data row 2 (sheet row 2), values in columns 1-3.
  const row: ColumnEncoding = { ...price, col: 2, values: [1, 2, 3] };
  const [f] = planFormatting(judgment([row], { orientation: "rows" }), [["", "m1", "m2", "m3"], ["b1", 1, 2, 3], ["b2", 1, 2, 3]], "calm");
  assert.deepEqual((f as Extract<Formatting, { kind: "scale" }>).blocks, [{ row: 2, col: 1, rows: 1, cols: 3 }]);
});

// ── The add-on against a stand-in for Apps Script ───────────────────────────

const letters = (col: number) => {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

interface FakeRule {
  readonly spec: Record<string, unknown>;
  readonly ranges: FakeRange[];
}

class FakeRange {
  readonly sheet: FakeSheet;
  readonly row: number;
  readonly col: number;
  readonly rows: number;
  readonly cols: number;
  constructor(sheet: FakeSheet, row: number, col: number, rows: number, cols: number) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.rows = rows;
    this.cols = cols;
  }
  getRow = () => this.row;
  getColumn = () => this.col;
  getNumRows = () => this.rows;
  getNumColumns = () => this.cols;
  getA1Notation = () =>
    this.rows * this.cols === 1
      ? `${letters(this.col)}${this.row}`
      : `${letters(this.col)}${this.row}:${letters(this.col + this.cols - 1)}${this.row + this.rows - 1}`;
  #grid = <T>(g: T[][]) => Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.cols }, (_, c) => g[this.row - 1 + r]![this.col - 1 + c]!));
  getDisplayValues = () => this.#grid(this.sheet.raw).map((r) => r.map((v) => (typeof v === "number" ? `$${v}` : String(v))));
  getValues = () => this.#grid(this.sheet.raw);
  getBackgrounds = () => this.#grid(this.sheet.backgrounds);
  setBackgrounds = (colors: (string | null)[][]) => {
    colors.forEach((r, i) => r.forEach((c, j) => (this.sheet.backgrounds[this.row - 1 + i]![this.col - 1 + j] = c ?? "#ffffff")));
    return this;
  };
  setBackground = (color: string | null) => this.setBackgrounds([[color]]);
  getCell = (r: number, c: number) => new FakeRange(this.sheet, this.row + r - 1, this.col + c - 1, 1, 1);
  getDataRegion = () => new FakeRange(this.sheet, 1, 1, this.sheet.raw.length, this.sheet.raw[0]!.length);
}

class FakeSheet {
  rules: FakeRule[] = [{ spec: { theirs: true }, ranges: [] }];
  meta: { key: string; value: string } | null = null;
  readonly backgrounds: string[][];
  readonly raw: unknown[][];
  constructor(raw: unknown[][]) {
    this.raw = raw;
    this.backgrounds = raw.map((r) => r.map(() => "#ffffff"));
  }
  getName = () => "Q3";
  getRange = (row: number | string, col?: number, rows?: number, cols?: number) => {
    if (typeof row === "number") return new FakeRange(this, row, col!, rows!, cols!);
    const [, l, n] = row.match(/^([A-Z]+)(\d+)$/)!;
    return new FakeRange(this, Number(n), [...l!].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0), 1, 1);
  };
  getConditionalFormatRules = () => this.rules.map((r) => ({ ...r, getRanges: () => r.ranges }));
  setConditionalFormatRules = (rules: FakeRule[]) => void (this.rules = rules.map(({ spec, ranges }) => ({ spec, ranges })));
  getDeveloperMetadata = () =>
    this.meta === null
      ? []
      : [{ getKey: () => this.meta!.key, getValue: () => this.meta!.value, setValue: (v: string) => ((this.meta!.value = v), undefined), remove: () => {} }];
  addDeveloperMetadata = (key: string, value: string) => ((this.meta = { key, value }), this);
}

const install = (sheet: FakeSheet, selection: FakeRange, reply: () => { status: number; body: unknown }) => {
  const alerts: string[] = [];
  const requests: unknown[] = [];
  const props = new Map<string, string>();
  const builder = () => {
    const spec: Record<string, unknown> = {};
    let ranges: FakeRange[] = [];
    const b = {
      setGradientMinpointWithValue: (c: string, _t: unknown, v: string) => ((spec["min"] = [c, v]), b),
      setGradientMidpointWithValue: (c: string, _t: unknown, v: string) => ((spec["mid"] = [c, v]), b),
      setGradientMaxpointWithValue: (c: string, _t: unknown, v: string) => ((spec["max"] = [c, v]), b),
      whenTextEqualTo: (t: string) => ((spec["text"] = t), b),
      setBackground: (c: string) => ((spec["background"] = c), b),
      setRanges: (r: FakeRange[]) => ((ranges = r), b),
      build: () => ({ spec, ranges }),
    };
    return b;
  };
  Object.assign(globalThis, {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getName: () => "Budget", getActiveSheet: () => sheet, getActiveRange: () => selection, toast: () => {} }),
      getUi: () => ({ alert: (m: string) => alerts.push(m) }),
      newConditionalFormatRule: builder,
      InterpolationType: { NUMBER: "NUMBER" },
    },
    PropertiesService: { getUserProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v) }) },
    UrlFetchApp: {
      fetch: (_url: string, params: { payload: string; headers: Record<string, string> }) => {
        requests.push({ body: JSON.parse(params.payload), install: params.headers["X-Practical-Data-Install"] });
        const { status, body } = reply();
        return { getResponseCode: () => status, getContentText: () => JSON.stringify(body), getHeaders: () => ({}) };
      },
    },
    Utilities: { getUuid: () => "6F1C0F3A-0B7E-4C8A-9D3E-2A1B4C5D6E7F" },
  });
  return { alerts, requests };
};

test("the add-on shades a selected table with Sheets rules, and removes only its own", async () => {
  const addon = await import("../src/sheets/addon.ts");
  const sheet = new FakeSheet(raw);
  const { alerts, requests } = install(sheet, new FakeRange(sheet, 1, 1, 1, 1), () => ({
    status: 200,
    body: { table: judgment([price, tier], { aggregateRows: [3] }) },
  }));

  addon.shadeTable();
  assert.deepEqual(alerts, []);
  assert.deepEqual(requests[0], {
    body: {
      title: "Budget",
      table: { title: "Q3", headers: ["Plan", "Price", "Tier"], rows: [["A", "$10", "Basic"], ["B", "$20", "Pro"], ["C", "$30", "Pro"], ["Total", "$60", ""]] },
    },
    install: "6f1c0f3a-0b7e-4c8a-9d3e-2a1b4c5d6e7f",
  });
  // A color scale on B2:B4 and two level rules on C2:C4, ahead of the sheet's own rule.
  assert.deepEqual(
    sheet.rules.map((r) => [Object.keys(r.spec).sort().join("+"), r.ranges.map((x) => x.getA1Notation()).join(",")]),
    [["max+mid+min", "B2:B4"], ["background+text", "C2:C4"], ["background+text", "C2:C4"], ["theirs", ""]],
  );

  // Shading again replaces, rather than stacks.
  addon.shadeTable();
  assert.equal(sheet.rules.length, 4);

  addon.removeShading();
  assert.deepEqual(sheet.rules.map((r) => r.spec), [{ theirs: true }]);
});

test("the add-on fills numbers stored as text, and restores the cells on removal", async () => {
  const addon = await import("../src/sheets/addon.ts");
  const sheet = new FakeSheet(raw.map((r) => r.map(String)));
  sheet.backgrounds[2]![1] = "#fff2cc";
  install(sheet, new FakeRange(sheet, 1, 1, 5, 3), () => ({ status: 200, body: { table: judgment([price], { aggregateRows: [3] }) } }));
  addon.shadeTable();
  assert.notEqual(sheet.backgrounds[1]![1], "#ffffff");
  assert.notEqual(sheet.backgrounds[2]![1], "#fff2cc");
  assert.equal(sheet.backgrounds[4]![1], "#ffffff", "the total row is left alone");
  addon.removeShading();
  assert.deepEqual(sheet.backgrounds.map((r) => r[1]), ["#ffffff", "#ffffff", "#fff2cc", "#ffffff", "#ffffff"]);
});

test("a spent allowance is explained, and nothing changes", async () => {
  const addon = await import("../src/sheets/addon.ts");
  const sheet = new FakeSheet(raw);
  const { alerts } = install(sheet, new FakeRange(sheet, 1, 1, 1, 1), () => ({ status: 429, body: { error: "install_limit", message: "…" } }));
  addon.shadeTable();
  assert.match(alerts[0]!, /allowance is used up/);
  assert.equal(sheet.rules.length, 1);
});
