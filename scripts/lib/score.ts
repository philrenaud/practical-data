/**
 * Scores a page judgment against its hand labels in fixtures/expectations.json.
 * The eval and the tests site both use it, so their results cannot differ.
 */
import type { ColumnEncoding, PageJudgment, Polarity } from "../../src/core/types.ts";

export type Spec =
  "none" | { kind: ColumnEncoding["kind"]; polarity?: Polarity[]; transform?: "linear" | "log"; order?: string[] };
export type TableExpect = Record<string, Spec> & { aggregateRows?: number[] };
export type PageExpect = Record<string, TableExpect> & { shared?: string[][] };

/** The property that a check tests. Each kind is one category on the tests site and one line of the eval tally. */
export type CheckKind = "detect" | "polarity" | "transform" | "order" | "aggregates" | "shared" | "orientation";

export interface Check {
  readonly kind: CheckKind;
  readonly page: string;
  readonly table: string | null;
  /** The column header, for column checks. */
  readonly column: string | null;
  readonly ok: boolean;
  readonly expected: string;
  readonly actual: string;
  /** The one-line report for a failing check, or null for a passing one. */
  readonly message: string | null;
  /** For a "detect" check, whether a failure is a false positive ("colored") or a miss ("missed"). */
  readonly side?: "colored" | "missed";
}

export const describeEncoding = (e: ColumnEncoding | undefined): string =>
  e === undefined
    ? "none"
    : e.kind === "quantitative"
      ? `${e.polarity}/${e.transform}`
      : `ordinal[${e.order.join(" < ")}]`;

export const scorePage = (slug: string, judgment: PageJudgment, expect: PageExpect): Check[] => {
  const checks: Check[] = [];
  const byKey = new Map<string, ColumnEncoding>();
  for (const t of judgment.tables) for (const e of t.encodings) byKey.set(`${t.id}:${e.header}`, e);

  for (const [tableId, columns] of Object.entries(expect)) {
    if (tableId === "shared" || tableId === "$comment") continue;
    const table = judgment.tables.find((t) => t.id === tableId);
    for (const [header, spec] of Object.entries(columns as TableExpect)) {
      if (Array.isArray(spec)) continue; // aggregateRows
      if (header === "@orientation") {
        const want = spec as unknown as string;
        const got = table?.orientation ?? "columns";
        const ok = got === want;
        checks.push({
          kind: "orientation",
          page: slug,
          table: tableId,
          column: null,
          ok,
          expected: want,
          actual: got,
          message: ok
            ? null
            : `${slug} ${tableId} orientation ${got} (want ${want}) P(rows)=${table?.rowsScore?.toFixed(2) ?? "n/a"}`,
        });
        continue;
      }
      const where = `${slug} ${tableId} "${header}"`;
      const actual = byKey.get(`${tableId}:${header}`);
      const reason = table?.skipped.find((s) => s.header === header);
      const why =
        reason === undefined
          ? ""
          : ` (skipped: ${reason.reason}${reason.comparable === null ? "" : ` p=${reason.comparable.toFixed(2)}`})`;
      if (spec === "none") {
        const ok = actual === undefined;
        checks.push({
          kind: "detect",
          page: slug,
          table: tableId,
          column: header,
          ok,
          expected: "none",
          actual: describeEncoding(actual),
          message: ok ? null : `${where} → ${describeEncoding(actual)}`,
          side: "colored",
        });
        continue;
      }
      const detected = actual?.kind === spec.kind;
      checks.push({
        kind: "detect",
        page: slug,
        table: tableId,
        column: header,
        ok: detected,
        expected: spec.kind,
        actual: describeEncoding(actual),
        message: detected ? null : `${where} expected ${spec.kind} → ${describeEncoding(actual)}${why}`,
        side: "missed",
      });
      if (!detected || actual === undefined) continue;
      if (spec.polarity !== undefined) {
        const ok = spec.polarity.includes(actual.polarity);
        const p = actual.evidence.polarity;
        checks.push({
          kind: "polarity",
          page: slug,
          table: tableId,
          column: header,
          ok,
          expected: spec.polarity.join("|"),
          actual: actual.polarity,
          message: ok
            ? null
            : `${where} polarity ${actual.polarity} (want ${spec.polarity.join("|")}) ↑${p.higher_is_better.toFixed(2)} ↓${p.lower_is_better.toFixed(2)} ·${p.neutral.toFixed(2)}`,
        });
      }
      if (spec.transform !== undefined && actual.kind === "quantitative") {
        const ok = actual.transform === spec.transform;
        checks.push({
          kind: "transform",
          page: slug,
          table: tableId,
          column: header,
          ok,
          expected: spec.transform,
          actual: actual.transform,
          message: ok
            ? null
            : `${where} transform ${actual.transform} (want ${spec.transform}) p(log)=${actual.evidence.log?.toFixed(2)}`,
        });
      }
      if (spec.order !== undefined && actual.kind === "ordinal") {
        const ok = actual.order.join("|") === spec.order.join("|");
        checks.push({
          kind: "order",
          page: slug,
          table: tableId,
          column: header,
          ok,
          expected: spec.order.join(" < "),
          actual: actual.order.join(" < "),
          message: ok ? null : `${where} order ${actual.order.join(" < ")}`,
        });
      }
    }
    const wantAgg = (columns as TableExpect).aggregateRows;
    if (wantAgg !== undefined) {
      const got = table?.aggregateRows ?? [];
      const ok = JSON.stringify([...got].sort()) === JSON.stringify(wantAgg);
      checks.push({
        kind: "aggregates",
        page: slug,
        table: tableId,
        column: null,
        ok,
        expected: JSON.stringify(wantAgg),
        actual: JSON.stringify(got),
        message: ok
          ? null
          : `${slug} ${tableId} aggregate rows ${JSON.stringify(got)} (want ${JSON.stringify(wantAgg)})`,
      });
    }
  }
  for (const group of expect.shared ?? []) {
    const groups = group.map((k) => byKey.get(k)?.group ?? null);
    const ok = groups[0] !== null && groups.every((g) => g === groups[0]);
    checks.push({
      kind: "shared",
      page: slug,
      table: null,
      column: group.join(" + "),
      ok,
      expected: "one scale",
      actual: JSON.stringify(groups),
      message: ok ? null : `${slug} not shared: ${group.join(" + ")} → ${JSON.stringify(groups)}`,
    });
  }
  return checks;
};

/** Returns the documented reason for a failing check from expectations.$known, matched by message prefix, or null. */
export const knownReason = (check: Check, known: Readonly<Record<string, string>>): string | null => {
  if (check.message === null) return null;
  const key = Object.keys(known).find((k) => check.message!.startsWith(k));
  return key === undefined ? null : known[key]!;
};
