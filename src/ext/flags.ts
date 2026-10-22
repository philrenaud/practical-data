/**
 * Flags from the dev build. A flag records a table that the extension got
 * wrong, with what it saw and decided, and files it as an issue in a private
 * GitHub repository. The store build has no flags: see `PD_FLAGS_REPO`.
 *
 * A flag stores two files in the repository, `flags/<id>/context.json` and
 * `flags/<id>/screenshot.png`, and opens an issue that links them. The issue
 * body repeats the parts that a reader needs at a glance.
 */
import type { TableJudgment, TableSnapshot } from "../core/types.ts";

/**
 * "owner/name" of the repository that receives flags. The build defines it:
 * null in the store build, so the bundler drops every use of this file there.
 * Code that runs flags tests `PD_FLAGS_REPO` directly, because only a direct
 * test lets the bundler drop the code.
 */
declare global {
  const PD_FLAGS_REPO: string | null;
}

/** What the content script knows about a flagged table. */
export interface FlagCapture {
  /** "shaded" when the extension painted the table, "unshaded" otherwise. */
  readonly kind: "shaded" | "unshaded";
  readonly url: string;
  readonly pageTitle: string;
  /** The value of `data-pd-status` when the user flagged. */
  readonly status: string;
  /** The table as the extractor reads it now. Null when the extractor skips the table. */
  readonly table: TableSnapshot | null;
  /** The judgment that painted the table. Null when nothing painted it. */
  readonly judgment: TableJudgment | null;
  /** The model named in the reply that painted the table. */
  readonly model: string | null;
  /** The table's outerHTML, cut at `MAX_HTML` characters. */
  readonly html: string;
  readonly htmlTruncated: boolean;
  readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number };
}

/** A capture with what only the worker knows. */
export interface FlagContext extends FlagCapture {
  readonly id: string;
  readonly flaggedAt: string;
  /** The manifest's `version_name`, which names the commit. */
  readonly build: string;
  readonly provider: string;
}

export const MAX_HTML = 200_000;

/** Messages between the content script and the worker about flags. */
export type FlagReply =
  { readonly ok: true; readonly issue: number } | { readonly ok: false; readonly message: string };

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || " ";

/** Describes one painted column in a few words. */
const shadedAs = (e: TableJudgment["encodings"][number]): string => {
  const direction =
    e.polarity === "higher_is_better"
      ? "higher is better"
      : e.polarity === "lower_is_better"
        ? "lower is better"
        : "neutral";
  return `${e.kind}, ${direction}, P(comparable) ${e.evidence.comparable.toFixed(2)}`;
};

/**
 * Returns the issue title and Markdown body for a flag. `files` is the base URL
 * of `flags/<id>/` in the repository.
 */
export const flagIssue = (ctx: FlagContext, files: string, screenshot: boolean): { title: string; body: string } => {
  const host = hostOf(ctx.url);
  const t = ctx.table;
  const name = t?.title ?? (t === null ? "a skipped table" : t.headers.filter(Boolean).slice(0, 4).join(", "));
  const title = `${host}: ${ctx.kind} ${name || "table"}`.slice(0, 120);

  const lines = [
    `**${ctx.kind === "shaded" ? "Shaded" : "Not shaded"}** on ${host} · ${ctx.provider}${ctx.model === null ? "" : ` (${ctx.model})`} · build ${ctx.build}`,
    "",
    ctx.url,
    "",
  ];
  if (t === null) {
    lines.push(
      "The extractor skips this table (layout, nested tables, editable, or fewer than two rows or columns).",
      "",
    );
  } else {
    lines.push(`${t.headers.length} columns, ${t.rows.length} data rows. Status \`${ctx.status}\`.`, "");
  }
  const j = ctx.judgment;
  if (j !== null && t !== null) {
    lines.push("| Column | Judged |", "| --- | --- |");
    const byCol = new Map<number, string>();
    for (const e of j.encodings) byCol.set(e.col, `**${shadedAs(e)}**`);
    for (const s of j.skipped) byCol.set(s.col, `skipped: ${s.reason}`);
    const headers = j.orientation === "rows" ? ["", ...t.rows.map((r) => r[0] ?? "")] : t.headers;
    headers.forEach((h, c) => {
      if (byCol.has(c)) lines.push(`| ${cell(h)} | ${cell(byCol.get(c)!)} |`);
    });
    lines.push(
      "",
      `Orientation ${j.orientation}${j.rowsScore === null ? "" : ` (P(rows) ${j.rowsScore.toFixed(2)})`}.`,
      "",
    );
  }
  if (screenshot) lines.push(`![screenshot](${files}/screenshot.png?raw=true)`, "");
  lines.push(`[context.json](${files}/context.json)`);
  return { title, body: lines.join("\n") };
};

/** A new flag id: the UTC time to the second, then four random hex digits. */
export const flagId = (now: Date, random: () => number = Math.random): string =>
  `${now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}-${Math.floor(random() * 0x10000)
    .toString(16)
    .padStart(4, "0")}`;

const base64Utf8 = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * Files a flag: writes its two files, then opens the issue. `png` is the
 * screenshot as base64, or null when the capture failed.
 */
export const fileFlag = async (
  ctx: FlagContext,
  png: string | null,
  token: string,
  repo: string,
  fetcher: typeof fetch = fetch,
): Promise<number> => {
  const api = async (path: string, method: string, body: unknown) => {
    const r = await fetcher(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`GitHub ${method} ${path}: ${r.status} ${(await r.text()).slice(0, 300)}`);
    return (await r.json()) as Record<string, unknown>;
  };
  const dir = `flags/${ctx.id}`;
  const put = (name: string, content: string) =>
    api(`/contents/${dir}/${name}`, "PUT", { message: `Flag ${ctx.id}: ${name}`, content });
  await put("context.json", base64Utf8(JSON.stringify(ctx, null, 2)));
  if (png !== null) await put("screenshot.png", png);
  const { title, body } = flagIssue(ctx, `https://github.com/${repo}/blob/main/${dir}`, png !== null);
  const issue = await api("/issues", "POST", { title, body, labels: ["flag"] });
  return Number(issue["number"]);
};
