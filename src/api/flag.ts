/**
 * Reports of wrong shading from store users. A report holds what the
 * extension's preview dialog shows — page title, optional URL, table headers,
 * and a few sample rows — and nothing else. `readFlag` refuses anything
 * outside that shape, and `fileUserFlag` opens an issue in the private flags
 * repository. The dev build's richer flags are in src/ext/flags.ts; this
 * module has no Workers dependencies, so Node tests and the extension can
 * load it.
 */

/** Size limits on one report. `readFlag` refuses, never clips: the client clips first (src/ext/flag-report.ts). */
export const FLAG_LIMITS = {
  /** The whole JSON body, in bytes. */
  bodyBytes: 32 * 1024,
  headers: 30,
  rows: 5,
  /** Each header, cell, or table title, in characters. */
  cell: 200,
  note: 500,
  pageTitle: 300,
  url: 2000,
  build: 100,
  lang: 35,
} as const;

/** A report as the preview dialog shows it. `url` is absent when the user unticks it. */
export interface FlagReport {
  readonly url?: string;
  readonly pageTitle: string;
  readonly pageLang?: string;
  /** "shaded" when the extension painted the table, "unshaded" otherwise. */
  readonly kind: "shaded" | "unshaded";
  readonly table: {
    readonly title: string | null;
    readonly headers: readonly string[];
    /** Sample rows, each with exactly `headers.length` cells. */
    readonly rows: readonly (readonly string[])[];
  };
  readonly note?: string;
  /** The manifest's `version_name`, which names the commit. */
  readonly build: string;
}

/** Why `readFlag` refused a body. `error` is the code in the refusal. */
export interface FlagRefused {
  readonly error: "flag";
  readonly message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length >= 1 && v.length <= max;
const strings = (v: unknown, max: number): v is readonly string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string" && s.length <= max);
const stringRows = (v: unknown, width: number): v is readonly (readonly string[])[] =>
  Array.isArray(v) && v.every((r) => strings(r, FLAG_LIMITS.cell) && r.length === width);
const webUrl = (v: unknown): v is string => {
  if (!text(v, FLAG_LIMITS.url)) return false;
  try {
    const { protocol } = new URL(v);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

/** Reads the body of a /flag request. Returns the report, or a `FlagRefused` for anything outside the shape. */
export const readFlag = (body: unknown): FlagReport | FlagRefused => {
  const refuse = (message: string): FlagRefused => ({ error: "flag", message });
  if (!isRecord(body)) return refuse("not a JSON object");
  const known = ["url", "pageTitle", "pageLang", "kind", "table", "note", "build"];
  const unknown = Object.keys(body).find((k) => !known.includes(k));
  if (unknown !== undefined) return refuse(`unknown field ${JSON.stringify(unknown.slice(0, 40))}`);
  const { url, pageTitle, pageLang, kind, table, note, build } = body;
  if (kind !== "shaded" && kind !== "unshaded") return refuse('kind must be "shaded" or "unshaded"');
  if (!text(pageTitle, FLAG_LIMITS.pageTitle))
    return refuse(`pageTitle must be 1 to ${FLAG_LIMITS.pageTitle} characters`);
  if (!text(build, FLAG_LIMITS.build)) return refuse(`build must be 1 to ${FLAG_LIMITS.build} characters`);
  if (url !== undefined && !webUrl(url))
    return refuse(`url must be an http(s) URL of at most ${FLAG_LIMITS.url} characters`);
  if (pageLang !== undefined && !text(pageLang, FLAG_LIMITS.lang))
    return refuse(`pageLang must be 1 to ${FLAG_LIMITS.lang} characters`);
  if (note !== undefined && !text(note, FLAG_LIMITS.note))
    return refuse(`note must be 1 to ${FLAG_LIMITS.note} characters`);
  if (!isRecord(table) || Object.keys(table).some((k) => !["title", "headers", "rows"].includes(k)))
    return refuse("table must have title, headers, and rows only");
  const { title, headers, rows } = table;
  if (title !== null && !text(title, FLAG_LIMITS.cell))
    return refuse(`table.title must be null or 1 to ${FLAG_LIMITS.cell} characters`);
  if (!strings(headers, FLAG_LIMITS.cell) || headers.length < 1 || headers.length > FLAG_LIMITS.headers)
    return refuse(
      `table.headers must be 1 to ${FLAG_LIMITS.headers} strings of at most ${FLAG_LIMITS.cell} characters`,
    );
  if (!stringRows(rows, headers.length) || rows.length > FLAG_LIMITS.rows)
    return refuse(
      `table.rows must be at most ${FLAG_LIMITS.rows} rows of ${headers.length} cells of at most ${FLAG_LIMITS.cell} characters`,
    );
  return {
    ...(url === undefined ? {} : { url }),
    pageTitle,
    ...(pageLang === undefined ? {} : { pageLang }),
    kind,
    table: { title, headers, rows },
    ...(note === undefined ? {} : { note }),
    build,
  };
};

const hostOf = (url: string | undefined): string => {
  if (url === undefined) return "(no url)";
  try {
    return new URL(url).hostname;
  } catch {
    return "(no url)";
  }
};

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || " ";

/** Returns the issue title and Markdown body for a report. The title follows the dev flags' convention. */
export const userFlagIssue = (report: FlagReport): { title: string; body: string } => {
  const host = hostOf(report.url);
  const t = report.table;
  const name = t.title ?? t.headers.filter(Boolean).slice(0, 4).join(", ");
  const title = `${host}: ${report.kind} ${name || "table"}`.slice(0, 120);
  const lines = [
    `**${report.kind === "shaded" ? "Shaded" : "Not shaded"}** on ${host} · build ${report.build} · from a store user, via POST /v1/flag`,
    "",
    report.url ?? "No page URL. The user left it out.",
    "",
    `Page: ${report.pageTitle}${report.pageLang === undefined ? "" : ` (${report.pageLang})`}`,
    `${t.headers.length} columns, ${t.rows.length} sample rows.`,
    "",
    `| ${t.headers.map(cell).join(" | ")} |`,
    `| ${t.headers.map(() => "---").join(" | ")} |`,
    ...t.rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ];
  if (report.note !== undefined) lines.push("", ...report.note.split("\n").map((l) => `> ${l}`));
  return { title, body: lines.join("\n") };
};

const GITHUB_TIMEOUT_MS = 10_000;

/** Opens the issue for a report. Returns the issue number, or throws without the response body. */
export const fileUserFlag = async (
  report: FlagReport,
  token: string,
  repo: string,
  fetcher: typeof fetch = fetch,
): Promise<number> => {
  const { title, body } = userFlagIssue(report);
  const r = await fetcher(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body, labels: ["flag", "user"] }),
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`GitHub POST /issues: ${r.status}`);
  return Number(((await r.json()) as Record<string, unknown>)["number"]);
};
