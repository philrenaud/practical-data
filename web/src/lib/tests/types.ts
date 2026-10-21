/** Types for the files in demo/tests/, which scripts/tests-data.ts writes. */
import type { Policy } from "../../../../src/decide/judge.ts";
import type { Answer, Question } from "../../../../src/decide/model.ts";
import type { ColumnEncoding, PageJudgment, TableJudgment, TableSnapshot } from "../../../../src/core/types.ts";
import type { Check, CheckKind } from "../../../../scripts/lib/score.ts";

export type { Check, CheckKind };

export interface ScoredCheck extends Check {
  /** Why a documented failure is accepted (expectations.$known), or null. */
  readonly known: string | null;
  /** The full column list of a shared-scale check, such as "t0:Input + t1:Input". Set on check pages, where `column` is one member. */
  readonly group?: string;
}

export interface PageSummary {
  readonly slug: string;
  /** A short, unique name for navigation. */
  readonly name: string;
  readonly title: string;
  readonly origin: "live" | "synthetic";
  readonly source: { readonly title: string; readonly url: string; readonly rights: string } | null;
  readonly tables: number;
  readonly columns: number;
  /** Passing checks and all checks on the page. */
  readonly score: readonly [number, number];
  readonly known: number;
  readonly requests: number;
  readonly inputTokens: number;
}

export interface UnitFile {
  readonly file: string;
  readonly tests: readonly {
    readonly name: string;
    readonly ok: boolean;
    readonly skipped: boolean;
    readonly ms: number;
  }[];
}

export interface ParseExample {
  readonly input: string;
  readonly missing: boolean;
  readonly date: boolean;
  /** The date that the cell names, such as "Dec 1993" or "3 days ago". Null if the cell is not a shaded date. */
  readonly when: string | null;
  readonly parsed: {
    readonly value: number;
    readonly unit: string | null;
    readonly bound: boolean;
    readonly range: readonly [number, number] | null;
  } | null;
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
  /** One recorded question for each question kind, such as "n#.polarity", with the request state sent with it. */
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

/** A test table. Its judgment is the entry with the same id in the page judgment. */
export interface TraceTable {
  readonly snapshot: TableSnapshot;
  /** Counts only. The requests are in requests/<slug>.json, keyed by table id. */
  readonly requests: { readonly count: number; readonly questions: number; readonly inputTokens: number };
}

/** The contents of demo/tests/requests/<slug>.json. Each table's requests, keyed by table id. */
export type PageRequests = Readonly<Record<string, readonly Exchange[]>>;

export interface TestPage extends Omit<PageSummary, "tables"> {
  readonly judgment: PageJudgment;
  readonly tables: readonly TraceTable[];
  readonly shared: readonly Exchange[];
  readonly checks: readonly ScoredCheck[];
}

/** Where a test table comes from, for its caption. */
export interface CaseSource {
  /** For example, "baseball-reference.com · Aaron Judge: batting". */
  readonly label: string;
  readonly url: string | null;
}

/** One table on a check page, with its checks of the page's kind. */
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
  /** For column checks, including shared-scale checks, `column` is this table's header. */
  readonly checks: readonly ScoredCheck[];
  readonly requests: number;
  /** The number of questions in those requests. */
  readonly questions: number;
}

/** One shared-scale check, with each column that it names. */
export interface ShareGroup {
  readonly check: ScoredCheck;
  readonly members: readonly {
    /** `${slug}:${table id}`, to find the member's CaseTable. */
    readonly key: string;
    readonly title: string;
    readonly header: string;
    readonly range: readonly [number, number] | null;
    readonly domain: readonly [number, number] | null;
    /** One cell as written on the page, such as "$39.00". The axis labels copy its format. */
    readonly format: string;
    /** The column's judgment, with the shared domain or order. */
    readonly encoding: ColumnEncoding | null;
    /** Header of the column that names each row (Team, Model, Location). */
    readonly labelHeader: string;
    readonly rows: readonly { readonly label: string; readonly cell: string; readonly value: number | null }[];
    readonly groupSizes: ReadonlyMap<string, number>;
  }[];
}
