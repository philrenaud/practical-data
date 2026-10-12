/**
 * The hosted endpoint, so the extension works without a key of the reader's
 * own. It accepts the same System One request the extension would send to
 * Jev, refuses anything the extension doesn't ask (allow.ts), answers repeats
 * from a shared cache, and forwards the rest to TypeSafe with the operator's
 * key, within per-install, per-IP and daily limits.
 *
 *   POST /v1/systemone   { model?, state, questions } → System One response
 *   GET  /v1/health      → { ok: true }
 *   GET  /v1/stats       today's counts (Authorization: Bearer STATS_TOKEN)
 *
 * Nothing is logged. The cache holds answers keyed by a hash of the request,
 * never the request itself; the daily counts hold install ids, and are
 * deleted two days later.
 */
import { Effect, Schema } from "effect";
import { DecisionResponse, hashJson, validateAnswers, type Question } from "../decide/model.ts";
import { checkQuestions, LIMITS } from "./allow.ts";
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

/** Only the extension may call: never a web page, and only listed extension ids when configured. */
const originAllowed = (origin: string | null, env: Env): boolean => {
  if (origin !== null && !origin.startsWith("chrome-extension://")) return false;
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.length === 0 || (origin !== null && allowed.includes(origin));
};

const readBody = async (request: Request): Promise<unknown> => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > LIMITS.bodyBytes) throw new Error("too large");
  const text = await request.text();
  if (text.length > LIMITS.bodyBytes) throw new Error("too large");
  return JSON.parse(text);
};

const decide = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  if (!originAllowed(request.headers.get("origin"), env)) return refuse(403, "origin", "This endpoint serves the Practical Data extension only.");
  const install = request.headers.get("x-practical-data-install") ?? "";
  if (!INSTALL_ID.test(install)) return refuse(400, "install", "Missing or malformed install id.");

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const [byInstall, byIp] = await Promise.all([env.RL_INSTALL.limit({ key: install }), env.RL_IP.limit({ key: ip })]);
  if (!byInstall.success || !byIp.success) return refuse(429, "rate_limited", "Too many requests; slow down.", { "Retry-After": "10" });

  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return refuse(400, "body", `Expected a JSON body under ${LIMITS.bodyBytes} bytes.`);
  }
  const { state, questions } = (body ?? {}) as { state?: unknown; questions?: unknown };
  const problem = checkQuestions(questions);
  if (problem !== null) return refuse(400, "questions", problem);
  const forward = { model: env.MODEL, state: state ?? {}, questions };

  // Shared answers: the same table on the same page asks the same questions for every reader.
  const key = await Effect.runPromise(hashJson(forward));
  const cacheKey = new Request(`https://answers.practicaldata.dev/${key}`);
  const hit = await caches.default.match(cacheKey);
  if (hit !== undefined) return new Response(hit.body, { headers: { "Content-Type": "application/json", "X-Cache": "hit" } });

  const quota = env.QUOTA.get(env.QUOTA.idFromName(today()));
  const reservation = await quota.reserve(install, {
    installRequests: Number(env.INSTALL_DAILY_REQUESTS),
    tokenBudget: Number(env.DAILY_TOKEN_BUDGET),
  });
  if (reservation !== "ok") {
    return refuse(
      429,
      reservation,
      reservation === "install_limit"
        ? "Today's free allowance for this browser is used up. Add your own key in the extension's options for unlimited use."
        : "Today's free allowance for everyone is used up. Add your own key in the extension's options, or try again tomorrow.",
      { "Retry-After": String(secondsToMidnightUtc()), "X-Practical-Data-Quota": reservation },
    );
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
    return refuse(503, "upstream", "The model didn't answer in time.");
  }
  if (!upstream.ok) {
    // The operator's key and the provider's messages stay here; the client learns only whether to retry.
    const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 503 : 502;
    const retry = upstream.headers.get("retry-after");
    return refuse(status, "upstream", `The model returned ${upstream.status}.`, retry === null ? {} : { "Retry-After": retry });
  }
  const decoded = Schema.decodeUnknownOption(DecisionResponse)(await upstream.json().catch(() => null));
  if (decoded._tag === "None" || validateAnswers(questions as Record<string, Question>, decoded.value) !== null) {
    return refuse(502, "upstream", "The model's answer didn't match the questions.");
  }
  const answer = JSON.stringify(decoded.value);
  ctx.waitUntil(
    Promise.all([
      quota.charge(decoded.value.usage.input_tokens),
      caches.default.put(cacheKey, new Response(answer, { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_TTL_S}` } })),
    ]),
  );
  return new Response(answer, { headers: { "Content-Type": "application/json", "X-Cache": "miss" } });
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/v1/systemone" && request.method === "POST") return decide(request, env, ctx);
    if (pathname === "/v1/health" && request.method === "GET") return json(200, { ok: true });
    if (pathname === "/v1/stats" && request.method === "GET") {
      const token = env.STATS_TOKEN ?? "";
      if (token === "" || request.headers.get("authorization") !== `Bearer ${token}`) return refuse(401, "auth", "Unauthorized.");
      return json(200, { day: today(), ...(await env.QUOTA.get(env.QUOTA.idFromName(today())).stats()) });
    }
    return refuse(404, "not_found", "Not found.");
  },
};
