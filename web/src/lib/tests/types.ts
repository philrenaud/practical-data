/** Shapes of demo/tests/*.json (written by scripts/tests-data.ts). */
import type { Policy } from "../../../../src/decide/judge.ts";
import type { Answer, Question } from "../../../../src/decide/model.ts";
import type { ColumnEncoding, PageJudgment, TableJudgment, TableSnapshot } from "../../../../src/core/types.ts";
import type { Check, CheckKind } from "../../../../scripts/lib/score.ts";

export type { Check, CheckKind };

export interface ScoredCheck extends Check {
  /** Why a documented failure is accepted (expectations.$known), or null. */
  readonly known: string | null;
  /** On a check page, a shared-scale check's full column list ("t0:Input + t1:Input"); `column` is then one member. */
  readonly group?: string;
}

export interface PageSummary {
  readonly slug: string;
  /** Short and distinct, for navigation. */
  readonly name: string;
  readonly title: string;
  readonly origin: "live" | "synthetic";
  readonly source: { readonly title: string; readonly url: string; readonly rights: string } | null;
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
  readonly tests: readonly { readonly name: string; readonly ok: boolean; readonly skipped: boolean; readonly ms: number }[];
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
  /** MAX_TRANSPOSE_ROWS from judge.ts. */
  readonly maxTransposeRows: number;
  readonly totals: Readonly<Record<CheckKind, { readonly ok: number; readonly total: number; readonly known: number }>>;
  readonly checks: readonly ScoredCheck[];
  readonly pages: readonly PageSummary[];
  readonly units: readonly UnitFile[];
  readonly parsing: readonly ParseExample[];
  /** One real question per question kind ("n#.polarity"), with the request state sent with it. */
  readonly samples: Readonly<Record<string, Sample>>;
  readonly known: Readonly<Record<string, string>>;
}

/** One request the judge sent and the answers it got. */
export interface Exchange {
  readonly state: unknown;
  readonly questions: Readonly<Record<string, Question>>;
  readonly answers: Readonly<Record<string, Answer>>;
  readonly inputTokens: number;
}

export interface Sample {
  readonly id: string;
  readonly question: Question;
  readonly answer?: Answer;
  readonly state: unknown;
  readonly page: string;
  /** Null for a page-level question (shared scales). */
  readonly table: string | null;
}

/** A test table; its judgment is the matching entry in the page's judgment. */
export interface TraceTable {
  readonly snapshot: TableSnapshot;
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

/** Where a test table comes from, for its caption. */
export interface CaseSource {
  /** "baseball-reference.com · Aaron Judge: batting". */
  readonly label: string;
  readonly url: string | null;
}

/** One table on a check page: the table as shaded, and the checks of that kind made on it. */
export interface CaseTable {
  readonly slug: string;
  readonly id: string;
  readonly title: string;
  /** 1-based position among the page's tables. */
  readonly position: number;
  readonly source: CaseSource;
  readonly snapshot: TableSnapshot;
  readonly judgment: TableJudgment;
  /** Shared-scale group sizes for the whole page, which the painter needs. */
  readonly groupSizes: ReadonlyMap<string, number>;
  /** `column` is this table's header for column checks (shared checks included). */
  readonly checks: readonly ScoredCheck[];
  readonly requests: number;
  /** Questions across those requests. */
  readonly questions: number;
}

/** One shared-scale check: the columns it names, their own ranges, and the scale each was painted on. */
export interface ShareGroup {
  readonly check: ScoredCheck;
  readonly members: readonly {
    /** `${slug}:${table id}`, to find the member's CaseTable. */
    readonly key: string;
    readonly title: string;
    readonly header: string;
    readonly range: readonly [number, number] | null;
    readonly domain: readonly [number, number] | null;
    /** One cell as written, so the scale can be labeled in the column's own format ("$39.00"). */
    readonly format: string;
    /** The column's judgment (with the shared domain or order), for painting its values. */
    readonly encoding: ColumnEncoding | null;
    /** Header of the column that names each row (Team, Model, Location). */
    readonly labelHeader: string;
    readonly rows: readonly { readonly label: string; readonly cell: string; readonly value: number | null }[];
    readonly groupSizes: ReadonlyMap<string, number>;
  }[];
}
