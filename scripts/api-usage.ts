/**
 * Prints the free endpoint's usage from Workers Analytics Engine: requests
 * per day by outcome, input tokens, and how many installs reached 100, 200,
 * and 400 model requests in a day. See src/api/usage.ts for the data points.
 *
 *   node scripts/api-usage.ts [days]
 *
 * The token is PD_CF_ANALYTICS_TOKEN, a Cloudflare API token with Account
 * Analytics Read. Without it, the script uses wrangler's login. The account
 * is PD_CF_ACCOUNT_ID, or the token's first account. The names are not
 * CLOUDFLARE_*, because wrangler deploys with CLOUDFLARE_API_TOKEN.
 */
import { execFileSync } from "node:child_process";

const DATASET = "practical_data_api";
const days = Number(process.argv[2] ?? "7");
if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("days: a whole number from 1 to 90");

const token =
  process.env["PD_CF_ANALYTICS_TOKEN"] ??
  execFileSync("npx", ["--no", "wrangler", "auth", "token"], { encoding: "utf8" }).trim().split("\n").at(-1)!;
const api = async (path: string, init?: RequestInit): Promise<Response> => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r;
};
const account =
  process.env["PD_CF_ACCOUNT_ID"] ??
  ((await (await api("/accounts")).json()) as { result: { id: string }[] }).result[0]!.id;

const sql = async <T>(query: string): Promise<T[]> => {
  const r = await api(`/accounts/${account}/analytics_engine/sql`, { method: "POST", body: `${query} FORMAT JSON` });
  return ((await r.json()) as { data: T[] }).data;
};

const since = `timestamp > NOW() - INTERVAL '${days}' DAY`;
const day = `formatDateTime(toStartOfInterval(timestamp, INTERVAL '1' DAY), '%Y-%m-%d')`;

const outcomes = await sql<{ day: string; outcome: string; n: string; tokens: string }>(
  `SELECT ${day} AS day, blob2 AS outcome, SUM(_sample_interval) AS n, SUM(_sample_interval * double2) AS tokens
   FROM ${DATASET} WHERE ${since} AND blob1 = 'systemone'
   GROUP BY day, outcome ORDER BY day, outcome`,
);
const actives = await sql<{ day: string; installs: string }>(
  `SELECT ${day} AS day, SUM(_sample_interval) AS installs
   FROM ${DATASET} WHERE ${since} AND blob2 = 'model' AND double3 = 1
   GROUP BY day ORDER BY day`,
);
const heavy = await sql<{ day: string; reached: string; installs: string }>(
  `SELECT ${day} AS day, double3 AS reached, SUM(_sample_interval) AS installs
   FROM ${DATASET} WHERE ${since} AND blob2 = 'model' AND (double3 = 100 OR double3 = 200 OR double3 = 400)
   GROUP BY day, reached ORDER BY day, reached`,
);
const upstreams = await sql<{ day: string; status: string; n: string }>(
  `SELECT ${day} AS day, double4 AS status, SUM(_sample_interval) AS n
   FROM ${DATASET} WHERE ${since} AND blob2 = 'upstream' AND double4 != 0
   GROUP BY day, status ORDER BY day, status`,
);
const probes = await sql<{ day: string; route: string; outcome: string; n: string }>(
  `SELECT ${day} AS day, blob1 AS route, blob2 AS outcome, SUM(_sample_interval) AS n
   FROM ${DATASET} WHERE ${since} AND blob1 != 'systemone'
   GROUP BY day, route, outcome ORDER BY day, route, outcome`,
);

const byDay = new Map<string, string[]>();
const line = (d: string, s: string) => byDay.set(d, [...(byDay.get(d) ?? []), s]);
for (const o of outcomes) {
  line(
    o.day,
    `${o.outcome.padEnd(14)} ${o.n.padStart(8)}${o.outcome === "model" ? `   ${Number(o.tokens).toLocaleString("en-US")} tokens` : ""}`,
  );
}
for (const a of actives) line(a.day, `active installs (first model request): ${a.installs}`);
for (const h of heavy) line(h.day, `installs that reached ${h.reached} requests: ${h.installs}`);
for (const u of upstreams) line(u.day, `upstream: the model returned ${u.status}: ${u.n}`);
for (const p of probes) line(p.day, `${p.route}/${p.outcome}: ${p.n}`);
if (byDay.size === 0) console.log(`No data points in the last ${days} days.`);
for (const [d, lines] of [...byDay].sort()) console.log(`${d}\n  ${lines.join("\n  ")}`);
