/**
 * Pulls the open flags from the dev build's flag repository into
 * artifacts/flags/<id>/, and prints one line per flag. Each directory gets the
 * flag's context.json, its screenshot.png, and page.html, a page with the
 * flagged table that the browser harnesses can load.
 *
 *   node scripts/flags.ts            open flags
 *   node scripts/flags.ts --all      open and closed flags
 *
 * It uses the GitHub CLI's login. The flags hold real page content, so they
 * stay in artifacts/, which git ignores. Never copy one into fixtures/.
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FlagContext } from "../src/ext/flags.ts";

const REPO = "philrenaud/practical-data-flags";
const OUT = "artifacts/flags";
const state = process.argv.includes("--all") ? "all" : "open";

const gh = (...args: string[]): string => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const ghBytes = (path: string): Buffer =>
  execFileSync("gh", ["api", "-H", "Accept: application/vnd.github.raw", path], { maxBuffer: 64 * 1024 * 1024 });

interface Issue {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly body: string;
}

const issues = JSON.parse(
  gh("issue", "list", "-R", REPO, "-l", "flag", "-s", state, "-L", "200", "--json", "number,title,state,body"),
) as Issue[];
if (issues.length === 0) console.log(`No ${state === "all" ? "" : "open "}flags.`);

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

for (const issue of issues.sort((a, b) => a.number - b.number)) {
  const id = /flags\/([\w-]+)\/context\.json/.exec(issue.body)?.[1];
  if (id === undefined) {
    console.log(`#${issue.number}  (no context) ${issue.title}`);
    continue;
  }
  const dir = join(OUT, id);
  await mkdir(dir, { recursive: true });
  const raw = ghBytes(`repos/${REPO}/contents/flags/${id}/context.json`);
  await writeFile(join(dir, "context.json"), raw);
  try {
    await writeFile(join(dir, "screenshot.png"), ghBytes(`repos/${REPO}/contents/flags/${id}/screenshot.png`));
  } catch {
    // The capture can fail, for example on a page that the browser won't screenshot.
  }
  const ctx = JSON.parse(raw.toString("utf8")) as FlagContext;
  await writeFile(
    join(dir, "page.html"),
    `<!doctype html>\n<meta charset="utf-8">\n<title>${escape(ctx.pageTitle)}</title>\n` +
      `<!-- Flag #${issue.number} from ${escape(ctx.url)}. Painted styles from the extension may remain. -->\n` +
      `${ctx.html}\n`,
  );
  const shaded = ctx.judgment?.encodings.map((e) => e.header || `col ${e.col}`).join(", ") ?? "";
  console.log(
    `#${issue.number}  ${ctx.kind.padEnd(8)} ${new URL(ctx.url).hostname.padEnd(24)} ${shaded === "" ? "-" : shaded}  ${dir}`,
  );
}
