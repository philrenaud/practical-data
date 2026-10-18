/** Shapes of demo/tests/*.json (written by scripts/tests-data.ts). */
import type { Policy } from "../../../../src/decide/judge.ts";
import type { Answer, Question } from "../../../../src/decide/model.ts";
import type { PageJudgment, TableSnapshot } from "../../../../src/core/types.ts";
import type { Check, CheckKind } from "../../../../scripts/lib/score.ts";

export type { Check, CheckKind };

export interface ScoredCheck extends Check {
  /** Why a documented failure is accepted (expectations.$known), or null. */
  readonly known: string | null;
}

export interface PageSummary {
  readonly slug: string;
  /** Short and distinct, for navigation. */
  readonly name: string;
  readonly title: string;
  readonly origin: "live" | "synthetic";
  readonly source: { readonly title: string; readonly url: string; readonly rights: string } | null;
  readonly notes: string | null;
  readonly tables: number;
  readonly columns: number;
  /** Checks passing, of all checks on the page. */
  readonly score: readonly [number, number];
  readonly known: number;
  readonly requests: number;
  readonly inputTokens: number;
}

export interface UnitFile {
  readonly file: string;
  readonly tests: readonly { readonly name: string; readonly ok: boolean; readonly ms: number }[];
}

export interface ParseExample {
  readonly input: string;
  readonly missing: boolean;
  readonly date: boolean;
  readonly parsed: { readonly value: number; readonly unit: string | null; readonly bound: boolean; readonly range: readonly [number, number] | null } | null;
}

export interface TestsIndex {
  readonly model: string;
  readonly requests: number;
  readonly inputTokens: number;
  readonly policy: Policy;
  readonly totals: Readonly<Record<CheckKind, { readonly ok: number; readonly total: number; readonly known: number }>>;
  readonly checks: readonly ScoredCheck[];
  readonly pages: readonly PageSummary[];
  readonly units: readonly UnitFile[];
  readonly parsing: readonly ParseExample[];
  /** One real question per question kind ("n#.polarity"), with the page it came from. */
  readonly samples: Readonly<Record<string, { readonly id: string; readonly question: Question; readonly answer?: Answer; readonly page: string }>>;
  readonly known: Readonly<Record<string, string>>;
}

/** One request the judge sent and the answers it got. */
export interface Exchange {
  readonly state: unknown;
  readonly questions: Readonly<Record<string, Question>>;
  readonly answers: Readonly<Record<string, Answer>>;
  readonly inputTokens: number;
}

export type Profile =
  | { readonly kind: "numeric"; readonly col: number; readonly header: string; readonly unit: string | null; readonly samples: readonly string[]; readonly spread: string }
  | { readonly kind: "categorical"; readonly col: number; readonly header: string; readonly levels: readonly string[] }
  | { readonly kind: "text"; readonly col: number; readonly header: string; readonly reason: string };

/** A test table; its judgment is the matching entry in the page's judgment. */
export interface TraceTable {
  readonly snapshot: TableSnapshot;
  readonly profiles: readonly Profile[];
  readonly expected: Readonly<Record<string, unknown>> | null;
  /** The requests themselves are in requests/<slug>.json, by table id. */
  readonly requests: { readonly count: number; readonly questions: number; readonly inputTokens: number };
}

/** demo/tests/requests/<slug>.json: each table's requests, by table id. */
export type PageRequests = Readonly<Record<string, readonly Exchange[]>>;

export interface TestPage extends Omit<PageSummary, "tables"> {
  readonly judgment: PageJudgment;
  readonly tables: readonly TraceTable[];
  readonly shared: readonly Exchange[];
  readonly checks: readonly ScoredCheck[];
}
