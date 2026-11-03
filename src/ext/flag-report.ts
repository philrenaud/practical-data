/**
 * Builds the report that the store build's "looks wrong" dialog previews and
 * sends to POST /v1/flag. The dialog shows the returned value verbatim: the
 * payload is the preview, with no hidden fields. The builder applies the
 * server's caps (src/api/flag.ts), so a report it returns always passes
 * `readFlag`. It reads no DOM and sends nothing.
 */
import { FLAG_LIMITS, type FlagReport } from "../api/flag.ts";
import type { TableSnapshot } from "../core/types.ts";

/** The page the flagged table is on. `url` is null when the user unticks it. */
export interface FlagPage {
  readonly url: string | null;
  readonly title: string;
  /** The document's language ("de", "pt-BR"). */
  readonly lang?: string;
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Returns the report for one table: the first sample rows, with long cells cut at an ellipsis. */
export const buildFlagReport = (
  table: TableSnapshot,
  page: FlagPage,
  kind: "shaded" | "unshaded",
  build: string,
  note?: string,
): FlagReport => {
  const headers = table.headers.slice(0, FLAG_LIMITS.headers).map((h) => clip(h, FLAG_LIMITS.cell));
  const rows = table.rows
    .slice(0, FLAG_LIMITS.rows)
    .map((r) => r.slice(0, headers.length).map((c) => clip(c, FLAG_LIMITS.cell)));
  const trimmed = note?.trim() ?? "";
  return {
    ...(page.url === null ? {} : { url: page.url.slice(0, FLAG_LIMITS.url) }),
    pageTitle: clip(page.title, FLAG_LIMITS.pageTitle) || "(untitled)",
    ...(page.lang === undefined || page.lang === "" ? {} : { pageLang: page.lang.slice(0, FLAG_LIMITS.lang) }),
    kind,
    table: {
      title: table.title === null ? null : clip(table.title, FLAG_LIMITS.cell),
      headers,
      rows,
    },
    ...(trimmed === "" ? {} : { note: clip(trimmed, FLAG_LIMITS.note) }),
    build: build.slice(0, FLAG_LIMITS.build),
  };
};
