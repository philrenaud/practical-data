/**
 * Shared data shapes. Everything here is plain JSON so it can cross the
 * content-script / service-worker message boundary and be written to disk
 * by the eval harness.
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

/** How one column should be colored. `col` indexes `TableSnapshot.headers`. */
export type ColumnEncoding =
  | {
      readonly kind: "quantitative";
      readonly col: number;
      readonly header: string;
      readonly polarity: Polarity;
      readonly transform: Transform;
      /** Most common unit in the column ("$", "%", "GB"); for legends. */
      readonly unit: string | null;
      /** Extent used for the color scale. Shared across tables when `group` is set. */
      readonly domain: readonly [number, number];
      /** Parsed value per data row; null for missing or unparseable cells. */
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
      /** Normalized category per data row; null for missing cells. */
      readonly values: readonly (string | null)[];
      readonly group: string | null;
      readonly evidence: Evidence;
    };

/** Raw model probabilities behind an encoding, kept for tooltips and evals. */
export interface Evidence {
  /** P(column is comparable): `role=measure` for numbers, `ordinal` for categories. */
  readonly comparable: number;
  readonly polarity: Readonly<Record<Polarity, number>>;
  /** P(log scale fits); null when the spread made the question moot. */
  readonly log: number | null;
  /** Mean probability of the chosen ordinal positions; null for numbers. */
  readonly orderConfidence: number | null;
}

/** A column the model looked at and declined to color, with why. */
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
   * every `col` below indexes the transposed table: column j + 1 is row j.
   */
  readonly orientation: "columns" | "rows";
  /** P(rows) from the model; null when the question wasn't asked or was overridden. */
  readonly rowsScore: number | null;
  readonly encodings: readonly ColumnEncoding[];
  readonly skipped: readonly SkippedColumn[];
  /** Row indexes judged to be totals/averages; excluded from domains. */
  readonly aggregateRows: readonly number[];
}

export interface PageJudgment {
  readonly url: string;
  readonly model: string;
  readonly tables: readonly TableJudgment[];
  /** Tables whose judgment failed (after retries); the rest are still painted. */
  readonly failed: readonly { readonly id: string; readonly reason: string }[];
  readonly usage: { readonly inputTokens: number; readonly requests: number };
}
