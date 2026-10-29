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
 *   GET  /v1/health      → { ok: true }
 *   GET  /v1/stats       → today's counts, with Authorization: Bearer STATS_TOKEN
 *
 * Every response except /v1/health adds one anonymous data point to
 * Analytics Engine (usage.ts).
 *
 * The Worker sets the model from MODEL and ignores a `model` in the body.
 * The Worker writes no logs. The cache holds answers under a hash of the
 * request, never the request itself. The daily counts hold install ids, and
 * each day's counts are deleted two days later.
 */
import {
  decodeDecisionResponse,
  hashJson,
  validateAnswers,
  type DecisionResponse,
  type Question,
} from "../decide/model.ts";
import { rateLimitKey, sameSecret } from "./admit.ts";
import { LIMITS, readBody, readRequest } from "./allow.ts";
import type { Quota } from "./quota.ts";
import { usagePoint } from "./usage.ts";

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
  /** Anonymous usage data points (usage.ts). Absent in tests. */
  readonly USAGE?: AnalyticsEngineDataset;
}

const CACHE_TTL_S = 30 * 24 * 60 * 60;
const UPSTREAM_TIMEOUT_MS = 20_000;
const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const refuse = (
  status: number,
  error: string,
  message: string,
  headers: Record<string, string> = {},
  extra: Record<string, number> = {},
) => json(status, { error, message, ...extra }, headers);

const today = () => new Date().toISOString().slice(0, 10);
const secondsToMidnightUtc = () => {
  const now = new Date();
  return Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000);
};

/**
 * Returns whether a request's Origin may use the endpoint. Only extension
 * origins pass, and when ALLOWED_ORIGINS is set, the origin must be in it.
 * A client outside a browser can send any Origin, so this check stops only
 * web pages. The install id and the rate limits apply to every caller.
 */
const originAllowed = (origin: string | null, env: Env): boolean => {
  if (origin === null || !origin.startsWith("chrome-extension://")) return false;
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
    return refuse(403, "origin", "This endpoint serves the Practical Data extension only.");
  const install = request.headers.get("x-practical-data-install") ?? "";
  if (!INSTALL_ID.test(install)) return refuse(400, "install", "Missing or malformed install id.");
  const ip = rateLimitKey(request.headers.get("cf-connecting-ip") ?? "unknown");
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
  const key = await hashJson(forward);
  const cacheKey = new Request(`https://answers.practicaldata.dev/${key}`);
  const hit = await caches.default.match(cacheKey);
  if (hit !== undefined) {
    const decoded = decodeDecisionResponse(await hit.json().catch(() => null));
    if (decoded !== null) return { response: decoded, remaining: null };
  }

  const body = JSON.stringify(forward);
  // In the recordings, every request uses fewer input tokens than its body has bytes.
  const estimate = new TextEncoder().encode(body).byteLength;
  const quota = env.QUOTA.get(env.QUOTA.idFromName(today()));
  const reservation = await quota.reserve(
    caller.install,
    { installRequests: Number(env.INSTALL_DAILY_REQUESTS), tokenBudget: Number(env.DAILY_TOKEN_BUDGET) },
    estimate,
  );
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
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    await quota.release(caller.install, estimate);
    return { refusal: refuse(503, "upstream", "The model didn't answer in time.") };
  }
  if (!upstream.ok) {
    await quota.release(caller.install, estimate);
    // Do not pass on the provider's error body. The status is enough for the client to decide whether to retry.
    // An upstream 429 becomes a 503, because the client reads a 429 without a quota header as this
    // endpoint's own rate limit and retries it several times.
    const status = upstream.status === 429 || upstream.status >= 500 ? 503 : 502;
    const retry = upstream.headers.get("retry-after");
    return {
      refusal: refuse(
        status,
        "upstream",
        `The model returned ${upstream.status}.`,
        retry === null ? {} : { "Retry-After": retry },
        { upstream: upstream.status },
      ),
    };
  }
  const decoded = decodeDecisionResponse(await upstream.json().catch(() => null));
  if (decoded === null || validateAnswers(questions, decoded) !== null) {
    // The model ran, so the request and its estimated tokens stay counted.
    return {
      refusal: refuse(502, "upstream", "The model's answer didn't match the questions.", {}, { upstream: 200 }),
    };
  }
  ctx.waitUntil(
    Promise.all([
      quota.settle(estimate, decoded.usage.input_tokens),
      caches.default.put(
        cacheKey,
        new Response(JSON.stringify(decoded), {
          headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_TTL_S}` },
        }),
      ),
    ]),
  );
  return { response: decoded, remaining: reservation.remaining };
};

/** Handles POST /v1/systemone. The Worker forwards the body as `readRequest` returns it. */
const decide = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  const caller = await admit(request, env);
  if (caller instanceof Response) return caller;
  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return refuse(400, "body", `Expected a JSON body under ${LIMITS.bodyBytes} bytes.`);
  }
  const read = readRequest(body);
  if ("error" in read) return refuse(400, read.error, read.message);
  const asked = await ask(env, ctx, caller, read.state, read.questions);
  if ("refusal" in asked) return asked.refusal;
  return new Response(JSON.stringify(asked.response), {
    headers: {
      "Content-Type": "application/json",
      ...(asked.remaining === null ? {} : allowanceHeaders(env, asked.remaining)),
    },
  });
};

const route = async (request: Request, env: Env, ctx: ExecutionContext, pathname: string): Promise<Response> => {
  if (pathname === "/v1/systemone" && request.method === "POST") return decide(request, env, ctx);
  if (pathname === "/v1/stats" && request.method === "GET") {
    if (!(await sameSecret(request.headers.get("authorization"), env.STATS_TOKEN ?? "")))
      return refuse(401, "auth", "Unauthorized.");
    return json(200, { day: today(), ...(await env.QUOTA.get(env.QUOTA.idFromName(today())).stats()) });
  }
  return refuse(404, "not_found", "Not found.");
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/v1/health" && request.method === "GET") return json(200, { ok: true });
    const response = await route(request, env, ctx, pathname);
    if (env.USAGE !== undefined) {
      const usage = env.USAGE;
      ctx.waitUntil(
        usagePoint(pathname, response.clone()).then(
          (p) => usage.writeDataPoint(p),
          () => undefined,
        ),
      );
    }
    return response;
  },
};
