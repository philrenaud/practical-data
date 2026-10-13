/**
 * The Google Sheets add-on. Runs in Apps Script: reads the selected table,
 * sends it to practicaldata.dev's /v1/judge, and writes the shading back as
 * Sheets' own conditional formatting (plan.ts decides what).
 *
 * What the add-on added is remembered per sheet in developer metadata, so
 * shading a table again or removing it touches only its own rules and
 * fills, never the sheet's other formatting. A rule whose range the user
 * has since moved (rows inserted above it) is no longer recognized and is
 * left in place.
 */
import { API_ORIGIN } from "./origin.ts";
import { planFormatting, requestFromRange, type Block, type Formatting } from "./plan.ts";
import { isPaletteId, PALETTES, DEFAULT_PALETTE, type PaletteId } from "../core/palettes.ts";
import type { ColumnEncoding, TableJudgment } from "../core/types.ts";

type Range = GoogleAppsScript.Range;
type Sheet = GoogleAppsScript.Sheet;

const META_KEY = "practical-data";

/** What the add-on added for each table it shaded, keyed by the table's A1 range. */
interface Added {
  readonly [table: string]: {
    /** Each rule's ranges, as A1 joined by commas. */
    readonly rules: string[];
    /** Cells filled directly, with the background each had before. */
    readonly fills: [string, string][];
  };
}

// ── Menu ────────────────────────────────────────────────────────────────────

export const onOpen = () => {
  const ui = SpreadsheetApp.getUi();
  const colors = ui.createMenu("Colors");
  for (const id of Object.keys(PALETTES) as PaletteId[]) colors.addItem(PALETTES[id].label, `palette_${id}`);
  ui.createAddonMenu()
    .addItem("Shade this table", "shadeTable")
    .addItem("Remove shading from this sheet", "removeShading")
    .addSeparator()
    .addSubMenu(colors)
    .addToUi();
};

export const onInstall = onOpen;

// ── Settings ────────────────────────────────────────────────────────────────

const props = () => PropertiesService.getUserProperties();

/** A random id per Google account, for the free allowance; created on first use. */
const installId = (): string => {
  const existing = props().getProperty("installId");
  if (existing !== null) return existing;
  const id = Utilities.getUuid().toLowerCase();
  props().setProperty("installId", id);
  return id;
};

const palette = (): PaletteId => {
  const p = props().getProperty("palette");
  return isPaletteId(p) ? p : DEFAULT_PALETTE;
};

export const setPalette = (id: PaletteId) => {
  props().setProperty("palette", id);
  SpreadsheetApp.getActiveSpreadsheet().toast(`${PALETTES[id].label}: ${PALETTES[id].note}. Shade a table to apply.`, "Practical Data");
};

// ── Bookkeeping ─────────────────────────────────────────────────────────────

const metadata = (sheet: Sheet) => sheet.getDeveloperMetadata().find((m) => m.getKey() === META_KEY);

const readAdded = (sheet: Sheet): Added => {
  try {
    return JSON.parse(metadata(sheet)?.getValue() ?? "{}") as Added;
  } catch {
    return {};
  }
};

const writeAdded = (sheet: Sheet, added: Added) => {
  const value = JSON.stringify(added);
  const m = metadata(sheet);
  if (m === undefined) sheet.addDeveloperMetadata(META_KEY, value);
  else m.setValue(value);
};

const signature = (ranges: readonly Range[]) => ranges.map((r) => r.getA1Notation()).join(",");

/** Removes what the add-on added for `tables`, and returns what is left on record. */
const remove = (sheet: Sheet, added: Added, tables: readonly string[]): Added => {
  const ours = new Set(tables.flatMap((t) => added[t]?.rules ?? []));
  if (ours.size > 0) {
    sheet.setConditionalFormatRules(sheet.getConditionalFormatRules().filter((r) => !ours.has(signature(r.getRanges()))));
  }
  for (const t of tables) for (const [a1, before] of added[t]?.fills ?? []) sheet.getRange(a1).setBackground(before === "#ffffff" ? null : before);
  return Object.fromEntries(Object.entries(added).filter(([t]) => !tables.includes(t)));
};

// ── Shading ─────────────────────────────────────────────────────────────────

/** The table to shade: the selection, or the whole block of data around a single selected cell. */
const selectedTable = (): Range | null => {
  const range = SpreadsheetApp.getActiveSpreadsheet().getActiveRange();
  if (range === null) return null;
  return range.getNumRows() * range.getNumColumns() === 1 ? range.getDataRegion() : range;
};

type Judged = { readonly table: TableJudgment | null } | { readonly problem: string };

const judge = (request: unknown): Judged => {
  const response = UrlFetchApp.fetch(`${API_ORIGIN}/v1/judge`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(request),
    headers: { "X-Practical-Data-Install": installId() },
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  let body: { table?: TableJudgment | null; error?: string; message?: string } = {};
  try {
    body = JSON.parse(response.getContentText()) as typeof body;
  } catch {
    // Non-JSON error page; the status says enough.
  }
  if (status === 200) return { table: body.table ?? null };
  if (body.error === "install_limit" || body.error === "budget_spent") return { problem: "Today's free allowance is used up. It resets at midnight UTC." };
  if (status === 429) return { problem: "Practical Data is busy. Try again in a few seconds." };
  return { problem: `Practical Data couldn't judge this table (${body.message ?? `error ${status}`}).` };
};

const describe = (e: ColumnEncoding): string => {
  if (e.kind === "ordinal") return `${e.header} (ordered)`;
  if (e.polarity === "neutral") return e.header;
  return `${e.header} (${e.polarity === "higher_is_better" ? "higher" : "lower"} is better)`;
};

export const shadeTable = () => {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sheet = ss.getActiveSheet();
  const selected = selectedTable();
  if (selected === null) return void ui.alert("Select a table, or a cell inside one, first.");

  const { request, rows, cols } = requestFromRange(selected.getDisplayValues(), ss.getName(), sheet.getName(), selected.getColumn() - 1);
  if (rows < 4 || cols < 2) return void ui.alert("Select a table with a header row, at least three rows of data and two columns.");
  const table = sheet.getRange(selected.getRow(), selected.getColumn(), rows, cols);

  ss.toast("Reading the table…", "Practical Data", 30);
  const judged = judge(request);
  if ("problem" in judged) return void ui.alert(judged.problem);
  const judgment = judged.table;
  if (judgment === null || judgment.encodings.length === 0) {
    const why = judgment?.skipped.map((s) => `${s.header}: ${s.reason}`).join("\n") ?? "";
    return void ui.alert(`Nothing here worth shading.${why === "" ? "" : `\n\n${why}`}`);
  }

  const key = table.getA1Notation();
  let added = remove(sheet, readAdded(sheet), [key]);
  const formatting = planFormatting(judgment, table.getValues(), palette());
  const at = (b: Block) => sheet.getRange(table.getRow() + b.row, table.getColumn() + b.col, b.rows, b.cols);
  const rules = formatting.flatMap((f) => buildRules(f, at));
  const fills = applyFills(formatting, table);

  // Ours go first: Sheets applies the first matching rule, and the reader asked for these.
  sheet.setConditionalFormatRules([...rules.map((r) => r.rule), ...sheet.getConditionalFormatRules()]);
  added = { ...added, [key]: { rules: rules.map((r) => r.signature), fills } };
  writeAdded(sheet, added);
  ss.toast(`Shaded ${judgment.encodings.map(describe).join(", ")}.`, "Practical Data", 8);
};

const buildRules = (f: Formatting, at: (b: Block) => Range): { rule: GoogleAppsScript.ConditionalFormatRule; signature: string }[] => {
  if (f.kind === "fill" || f.blocks.length === 0) return [];
  const ranges = f.blocks.map(at);
  const sig = signature(ranges);
  if (f.kind === "scale") {
    const number = SpreadsheetApp.InterpolationType.NUMBER;
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpointWithValue(f.min.color, number, String(f.min.value))
      .setGradientMidpointWithValue(f.mid.color, number, String(f.mid.value))
      .setGradientMaxpointWithValue(f.max.color, number, String(f.max.value))
      .setRanges(ranges)
      .build();
    return [{ rule, signature: sig }];
  }
  return f.levels.map((level) => ({
    rule: SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(level.text).setBackground(level.color).setRanges(ranges).build(),
    signature: sig,
  }));
};

/** Fills cells directly, in one write, and returns each filled cell's earlier background. */
const applyFills = (formatting: readonly Formatting[], table: Range): [string, string][] => {
  const cells = formatting.flatMap((f) => (f.kind === "fill" ? f.cells : []));
  if (cells.length === 0) return [];
  const backgrounds = table.getBackgrounds();
  const before: [string, string][] = cells.map((c) => [table.getCell(c.row + 1, c.col + 1).getA1Notation(), backgrounds[c.row]![c.col]!]);
  for (const c of cells) backgrounds[c.row]![c.col] = c.color;
  table.setBackgrounds(backgrounds);
  return before;
};

export const removeShading = () => {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const added = readAdded(sheet);
  writeAdded(sheet, remove(sheet, added, Object.keys(added)));
  ss.toast("Removed Practical Data's shading from this sheet.", "Practical Data", 5);
};
