/**
 * Shared data shapes. Every type is plain JSON, so values can pass between the
 * content script and the service worker in messages, and the eval script can
 * write them to disk.
 */

/** A table read from the DOM, reduced to text. */
export interface TableSnapshot {
  /** Stable within a page: `t<document-order index>`. */
  readonly id: string;
  /** `<caption>` text, or the nearest preceding heading. */
  readonly title: string | null;
  readonly headers: readonly string[];
  /** Data rows only. Every row has exactly `headers.length` cells. */
  readonly rows: readonly (readonly string[])[];
}

export interface PageSnapshot {
  readonly url: string;
  readonly title: string;
  readonly tables: readonly TableSnapshot[];
}

/** Direction of preference for a column's values. */
export type Polarity = "higher_is_better" | "lower_is_better" | "neutral";

export type Transform = "linear" | "log";

/** How to shade one column. `col` indexes `TableSnapshot.headers`. */
export type ColumnEncoding =
  | {
      readonly kind: "quantitative";
      readonly col: number;
      readonly header: string;
      readonly polarity: Polarity;
      readonly transform: Transform;
      /** The most common unit in the column ("$", "%", "GB"), for legends. */
      readonly unit: string | null;
      /** Extent used for the color scale. Shared across tables when `group` is set. */
      readonly domain: readonly [number, number];
      /** The parsed value of each data row. Null for missing or unparseable cells. */
      readonly values: readonly (number | null)[];
      readonly group: string | null;
      readonly evidence: Evidence;
    }
  | {
      readonly kind: "ordinal";
      readonly col: number;
      readonly header: string;
      readonly polarity: Polarity;
      /** Distinct values, least to most. Shared across tables when `group` is set. */
      readonly order: readonly string[];
      /** `order` as written on the page ("Lightweight", not "lightweight"). */
      readonly labels: readonly string[];
      /** The normalized category of each data row. Null for missing cells. */
      readonly values: readonly (string | null)[];
      readonly group: string | null;
      readonly evidence: Evidence;
    };

/** The model probabilities behind an encoding, kept for display and evals. */
export interface Evidence {
  /** P(column is comparable). For numbers it is `role=measure`, for categories `ordinal`. */
  readonly comparable: number;
  readonly polarity: Readonly<Record<Polarity, number>>;
  /** P(log scale fits). Null when the question was not asked. */
  readonly log: number | null;
  /** The mean probability of the chosen ordinal positions. Null for numbers. */
  readonly orderConfidence: number | null;
}

/** A column the judge did not shade, and the reason. */
export interface SkippedColumn {
  readonly col: number;
  readonly header: string;
  readonly reason: string;
  readonly comparable: number | null;
}

export interface TableJudgment {
  readonly id: string;
  /**
   * "rows" when values compare across each row (benchmarks × models). Then
   * every `col` below indexes the transposed table, where column j + 1 is row j.
   */
  readonly orientation: "columns" | "rows";
  /** P(rows) from the model. Null when the question was not asked or the user chose the orientation. */
  readonly rowsScore: number | null;
  readonly encodings: readonly ColumnEncoding[];
  readonly skipped: readonly SkippedColumn[];
  /** Indexes of rows judged to be totals or averages. Domains leave them out. */
  readonly aggregateRows: readonly number[];
}

export interface PageJudgment {
  readonly url: string;
  readonly model: string;
  readonly tables: readonly TableJudgment[];
  /** Tables whose judgment failed after retries. The other tables are still painted. */
  readonly failed: readonly { readonly id: string; readonly reason: string }[];
  readonly usage: { readonly inputTokens: number; readonly requests: number };
}
