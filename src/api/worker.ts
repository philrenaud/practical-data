/**
 * The Cloudflare Worker behind api.practicaldata.dev. It lets the extension
 * work without the user's own TypeSafe key. It accepts the System One
 * requests that the extension sends and refuses questions that the extension
 * does not ask (see allow.ts). It answers repeated requests from a shared
 * cache and forwards the rest to TypeSafe with the operator's key.
 * Per-install, per-IP, and daily limits apply. See README.md in this
 * directory.
 *
 *   POST /v1/systemone   { state, questions } → System One response
 *   POST /v1/judge       { title, table } → { table, usage }
 *   GET  /v1/health      → { ok: true }
 *   GET  /v1/stats       → today's counts, with Authorization: Bearer STATS_TOKEN
 *
 * The Worker sets the model from MODEL and ignores a `model` in the body.
 * The Worker writes no logs. The cache holds answers under a hash of the
 * request, never the request itself. The daily counts hold install ids, and
 * each day's counts are deleted two days later.
 */
import { Effect, Schema } from "effect";
import { judgePage } from "../decide/judge.ts";
import {
  DecisionError,
  DecisionModel,
  DecisionResponse,
  hashJson,
  validateAnswers,
  type Question,
} from "../decide/model.ts";
import { checkRequest, LIMITS, readBody, readJudgeBody } from "./allow.ts";
import type { Quota } from "./quota.ts";

export { Quota } from "./quota.ts";

interface Env {
  readonly TYPESAFE_API_KEY: string;
  readonly UPSTREAM_URL: string;
  readonly MODEL: string;
  /** Comma-separated chrome-extension:// origins; empty accepts any extension. */
  readonly ALLOWED_ORIGINS: string;
  readonly INSTALL_DAILY_REQUESTS: string;
  readonly DAILY_TOKEN_BUDGET: string;
  readonly STATS_TOKEN?: string;
  readonly QUOTA: DurableObjectNamespace<Quota>;
  readonly RL_INSTALL: RateLimit;
  readonly RL_IP: RateLimit;
}

const CACHE_TTL_S = 30 * 24 * 60 * 60;
const UPSTREAM_TIMEOUT_MS = 20_000;
const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const refuse = (status: number, error: string, message: string, headers: Record<string, string> = {}) =>
  json(status, { error, message }, headers);

const today = () => new Date().toISOString().slice(0, 10);
const secondsToMidnightUtc = () => {
  const now = new Date();
  return Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000);
};

/**
 * Returns whether a request's Origin may use the endpoint. Web-page origins
 * are refused. A request with no Origin comes from a server, such as the
 * Sheets add-on's Apps Script, and passes. When ALLOWED_ORIGINS is set, an
 * extension origin must be in it.
 */
const originAllowed = (origin: string | null, env: Env): boolean => {
  if (origin === null) return true;
  if (!origin.startsWith("chrome-extension://")) return false;
  const allowed = env.ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.length === 0 || allowed.includes(origin);
};

/** A request that passed `admit`. */
interface Caller {
  readonly install: string;
}

/**
 * Checks the origin, the install id, and the rate limits. Every route that
 * spends the operator's key calls it first. Returns the caller, or the
 * refusal to send.
 */
const admit = async (request: Request, env: Env): Promise<Caller | Response> => {
  if (!originAllowed(request.headers.get("origin"), env))
    return refuse(403, "origin", "This endpoint serves the Practical Data extension and add-on only.");
  const install = request.headers.get("x-practical-data-install") ?? "";
  if (!INSTALL_ID.test(install)) return refuse(400, "install", "Missing or malformed install id.");
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const [byInstall, byIp] = await Promise.all([env.RL_INSTALL.limit({ key: install }), env.RL_IP.limit({ key: ip })]);
  if (!byInstall.success || !byIp.success)
    return refuse(429, "rate_limited", "Too many requests; slow down.", { "Retry-After": "10" });
  return { install };
};

/**
 * The result of `ask`. `remaining` is the number of requests the caller has
 * left today. It is null on a cache hit, because a hit spends nothing.
 */
type Asked =
  { readonly response: DecisionResponse; readonly remaining: number | null } | { readonly refusal: Response };

/**
 * Headers that report the caller's daily allowance. Only responses that
 * spent from the allowance carry them. A cache hit spends nothing, so the
 * client keeps its last count.
 */
const allowanceHeaders = (env: Env, remaining: number): Record<string, string> => ({
  "X-Practical-Data-Remaining": String(remaining),
  "X-Practical-Data-Limit": env.INSTALL_DAILY_REQUESTS,
});

/**
 * Answers one System One request. A request that any caller sent before
 * comes from the shared cache. Any other request spends one request of the
 * caller's daily allowance and goes to TypeSafe. The caller of `ask` must
 * check `questions` against the allowlist first.
 */
const ask = async (
  env: Env,
  ctx: ExecutionContext,
  caller: Caller,
  state: unknown,
  questions: Readonly<Record<string, Question>>,
): Promise<Asked> => {
  const forward = { model: env.MODEL, state: state ?? {}, questions };

  // The same table produces the same request for every user, so one answer serves them all.
  const key = await Effect.runPromise(hashJson(forward));
  const cacheKey = new Request(`https://answers.practicaldata.dev/${key}`);
  const hit = await caches.default.match(cacheKey);
  if (hit !== undefined) {
    const decoded = Schema.decodeUnknownOption(DecisionResponse)(await hit.json().catch(() => null));
    if (decoded._tag === "Some") return { response: decoded.value, remaining: null };
  }

  const quota = env.QUOTA.get(env.QUOTA.idFromName(today()));
  const reservation = await quota.reserve(caller.install, {
    installRequests: Number(env.INSTALL_DAILY_REQUESTS),
    tokenBudget: Number(env.DAILY_TOKEN_BUDGET),
  });
  const allowance = allowanceHeaders(env, reservation.remaining);
  if (reservation.status !== "ok") {
    return {
      refusal: refuse(
        429,
        reservation.status,
        reservation.status === "install_limit"
          ? "You've used today's free allowance. It resets at midnight UTC."
          : "Today's free allowance is used up for everyone. It resets at midnight UTC.",
        { ...allowance, "Retry-After": String(secondsToMidnightUtc()), "X-Practical-Data-Quota": reservation.status },
      ),
    };
  }

  let upstream: Response;
  try {
    upstream = await fetch(env.UPSTREAM_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(forward),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    await quota.release(caller.install);
    return { refusal: refuse(503, "upstream", "The model didn't answer in time.") };
  }
  if (!upstream.ok) {
    await quota.release(caller.install);
    // Do not pass on the provider's error body. The status is enough for the client to decide whether to retry.
    const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 503 : 502;
    const retry = upstream.headers.get("retry-after");
    return {
      refusal: refuse(
        status,
        "upstream",
        `The model returned ${upstream.status}.`,
        retry === null ? {} : { "Retry-After": retry },
      ),
    };
  }
  const decoded = Schema.decodeUnknownOption(DecisionResponse)(await upstream.json().catch(() => null));
  if (decoded._tag === "None" || validateAnswers(questions, decoded.value) !== null) {
    return { refusal: refuse(502, "upstream", "The model's answer didn't match the questions.") };
  }
  ctx.waitUntil(
    Promise.all([
      quota.charge(decoded.value.usage.input_tokens),
      caches.default.put(
        cacheKey,
        new Response(JSON.stringify(decoded.value), {
          headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_TTL_S}` },
        }),
      ),
    ]),
  );
  return { response: decoded.value, remaining: reservation.remaining };
};

/** Handles POST /v1/systemone. The body must pass `checkRequest`. */
const decide = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  const caller = await admit(request, env);
  if (caller instanceof Response) return caller;
  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return refuse(400, "body", `Expected a JSON body under ${LIMITS.bodyBytes} bytes.`);
  }
  const { state, questions } = (body ?? {}) as { state?: unknown; questions?: unknown };
  const problem = checkRequest(body);
  if (problem !== null) return refuse(400, "questions", problem);
  const asked = await ask(env, ctx, caller, state, questions as Record<string, Question>);
  if ("refusal" in asked) return asked.refusal;
  return new Response(JSON.stringify(asked.response), {
    headers: {
      "Content-Type": "application/json",
      "X-Cache": asked.remaining === null ? "hit" : "miss",
      ...(asked.remaining === null ? {} : allowanceHeaders(env, asked.remaining)),
    },
  });
};

/**
 * Handles POST /v1/judge. The body is one table, and the response is the
 * table's judgment. Clients that cannot run the judge, such as the Sheets
 * add-on, use this route. The Worker builds the questions from the table
 * with `judgePage`. The client sends only table text, so this route needs no
 * allowlist.
 *
 *   { title, table: { title, headers, rows } } → { table: TableJudgment | null, usage }
 */
const judge = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  const caller = await admit(request, env);
  if (caller instanceof Response) return caller;
  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return refuse(400, "body", `Expected a JSON body under ${LIMITS.bodyBytes} bytes.`);
  }
  const page = readJudgeBody(body);
  if (typeof page === "string") return refuse(400, "table", page);

  // The caller gets the first refusal, such as a spent allowance or an upstream failure.
  let refusal: Response | null = null;
  let remaining: number | null = null;
  const model = DecisionModel.of({
    name: env.MODEL,
    evaluate: (req) =>
      Effect.forEach(
        chunk(Object.entries(req.questions), LIMITS.questions),
        (entries) =>
          Effect.promise(() => ask(env, ctx, caller, req.state, Object.fromEntries(entries))).pipe(
            Effect.flatMap((asked) => {
              if ("response" in asked) {
                if (asked.remaining !== null) remaining = Math.min(remaining ?? Infinity, asked.remaining);
                return Effect.succeed(asked.response);
              }
              refusal ??= asked.refusal;
              const quota = asked.refusal.headers.get("x-practical-data-quota") !== null;
              return Effect.fail(new DecisionError({ reason: quota ? "quota" : "network", message: "refused" }));
            }),
          ),
        { concurrency: 4 },
      ).pipe(
        Effect.map((responses) => ({
          model: env.MODEL,
          answers: Object.assign({}, ...responses.map((r) => r.answers)),
          usage: { input_tokens: responses.reduce((n, r) => n + r.usage.input_tokens, 0) },
        })),
      ),
  });
  const result = await Effect.runPromise(
    Effect.result(judgePage(page).pipe(Effect.provideService(DecisionModel, model))),
  );
  if (result._tag === "Failure") return refusal ?? refuse(502, "upstream", "The table couldn't be judged.");
  if (result.success.failed.length > 0 && refusal !== null) return refusal;
  return json(
    200,
    { table: result.success.tables[0] ?? null, usage: result.success.usage },
    remaining === null ? {} : allowanceHeaders(env, remaining),
  );
};

const chunk = <A>(xs: readonly A[], size: number): A[][] => {
  const out: A[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/v1/systemone" && request.method === "POST") return decide(request, env, ctx);
    if (pathname === "/v1/judge" && request.method === "POST") return judge(request, env, ctx);
    if (pathname === "/v1/health" && request.method === "GET") return json(200, { ok: true });
    if (pathname === "/v1/stats" && request.method === "GET") {
      const token = env.STATS_TOKEN ?? "";
      if (token === "" || request.headers.get("authorization") !== `Bearer ${token}`)
        return refuse(401, "auth", "Unauthorized.");
      return json(200, { day: today(), ...(await env.QUOTA.get(env.QUOTA.idFromName(today())).stats()) });
    }
    return refuse(404, "not_found", "Not found.");
  },
};
