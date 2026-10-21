/**
 * The provider layer for the decision model. The hosted endpoint, TypeSafe's
 * Jev, and Cloudflare's Clef take the same System One request and return the
 * same answers. Each provider is a `Transport` with a per-request question
 * limit. Code outside this file sees only decoded and validated answers.
 */
import { mapConcurrent, sleep } from "./concurrency.ts";

// ── Request ─────────────────────────────────────────────────────────────────

/** Question text: a string, or JSON structure. See "Advanced: structure" in the TypeSafe docs. */
export type Prose = string | Readonly<Record<string, unknown>> | readonly unknown[];

/** One question in a System One request. */
export type Question =
  | {
      readonly type: "noul";
      readonly instructions: Prose;
      readonly criteria?: { readonly true?: Prose; readonly false?: Prose };
    }
  | {
      readonly type: "choice";
      readonly instructions: Prose;
      readonly criteria: Readonly<Record<string, Prose | null>>;
    }
  | { readonly type: "score"; readonly instructions: Prose; readonly criteria: readonly Prose[] };

/** The state, and the questions to ask about it, keyed by question id. */
export interface DecisionRequest {
  readonly state: unknown;
  readonly questions: Readonly<Record<string, Question>>;
}

// ── Response ────────────────────────────────────────────────────────────────

/** The answer to one question. */
export type Answer =
  | { readonly type: "noul"; readonly noul: number }
  | {
      readonly type: "choice";
      readonly choice: string;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence: number;
    }
  | {
      readonly type: "score";
      readonly score: number;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence: number;
    };

/** A System One response: the model version, the answers by question id, and the input tokens. */
export interface DecisionResponse {
  readonly model: string;
  readonly answers: Readonly<Record<string, Answer>>;
  readonly usage: { readonly input_tokens: number };
}

/** True for an object that is not null and not an array. */
const isRecord = (x: unknown): x is Readonly<Record<string, unknown>> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Decodes a record of numbers. Returns null if a value is not a number. */
const decodeProbabilities = (x: unknown): Readonly<Record<string, number>> | null => {
  if (!isRecord(x)) return null;
  const entries = Object.entries(x);
  return entries.every(([, p]) => typeof p === "number")
    ? (Object.fromEntries(entries) as Record<string, number>)
    : null;
};

/** Decodes one answer. Returns null if its fields do not match its type. The result has only the known fields. */
const decodeAnswer = (x: unknown): Answer | null => {
  if (!isRecord(x)) return null;
  if (x["type"] === "noul") return typeof x["noul"] === "number" ? { type: "noul", noul: x["noul"] } : null;
  if (x["type"] !== "choice" && x["type"] !== "score") return null;
  const probabilities = decodeProbabilities(x["probabilities"]);
  const confidence = x["confidence"];
  if (probabilities === null || typeof confidence !== "number") return null;
  if (x["type"] === "choice")
    return typeof x["choice"] === "string" ? { type: "choice", choice: x["choice"], probabilities, confidence } : null;
  return typeof x["score"] === "number" ? { type: "score", score: x["score"], probabilities, confidence } : null;
};

/**
 * Decodes a System One response. Returns null if it does not have the
 * shape of `DecisionResponse`. The result has only the known fields.
 * `Object.fromEntries` keeps a key such as "__proto__" as data.
 */
export const decodeDecisionResponse = (x: unknown): DecisionResponse | null => {
  if (!isRecord(x) || typeof x["model"] !== "string" || !isRecord(x["answers"]) || !isRecord(x["usage"])) return null;
  const inputTokens = x["usage"]["input_tokens"];
  if (typeof inputTokens !== "number") return null;
  const answers: [string, Answer][] = [];
  for (const [id, raw] of Object.entries(x["answers"])) {
    const answer = decodeAnswer(raw);
    if (answer === null) return null;
    answers.push([id, answer]);
  }
  return { model: x["model"], answers: Object.fromEntries(answers), usage: { input_tokens: inputTokens } };
};

// ── Errors ──────────────────────────────────────────────────────────────────

export type DecisionErrorReason =
  | "auth"
  | "rate_limited"
  | "overloaded"
  | "bad_request"
  | "network"
  | "decode"
  | "missing_config"
  /** This install has used its daily allowance on the hosted endpoint. */
  | "quota"
  /** The hosted endpoint's allowance for everyone is spent for the day. */
  | "quota_everyone";

/** A failed request. Requests that fail with `rate_limited`, `overloaded`, or `network` are retried. */
export class DecisionError extends Error {
  readonly reason: DecisionErrorReason;
  constructor({ reason, message }: { readonly reason: DecisionErrorReason; readonly message: string }) {
    super(message);
    this.name = "DecisionError";
    this.reason = reason;
  }
}

const isTransient = (e: DecisionError): boolean =>
  e.reason === "rate_limited" || e.reason === "overloaded" || e.reason === "network";

const reasonForStatus = (status: number): DecisionErrorReason =>
  status === 401 || status === 403
    ? "auth"
    : status === 429
      ? "rate_limited"
      : status >= 500
        ? "overloaded"
        : "bad_request";

// ── Service ─────────────────────────────────────────────────────────────────

/** The decision model: one provider, with its cache. */
export interface DecisionModel {
  /** The provider's model name, such as "jev-latest" or "clef". */
  readonly name: string;
  /**
   * Asks every question in `request`. Splits them into requests of the
   * provider's maximum size. Rejects with a `DecisionError`. If `signal`
   * aborts, requests in flight stop and no retries start.
   */
  readonly evaluate: (request: DecisionRequest, signal?: AbortSignal) => Promise<DecisionResponse>;
}

/**
 * A cache of responses, keyed by `hashJson` of the request body. The
 * extension keeps entries in chrome.storage. The scripts keep them as files
 * in fixtures/recordings, so offline runs replay recorded answers.
 */
export interface AnswerCache {
  readonly get: (key: string) => Promise<DecisionResponse | undefined>;
  readonly set: (key: string, value: DecisionResponse) => Promise<void>;
}

/** A cache that holds nothing. Providers use it when they get no cache. */
export const noCache: AnswerCache = {
  get: async () => undefined,
  set: async () => undefined,
};

/** Returns the hex SHA-256 of `JSON.stringify(value)`. Runs in service workers and Node. */
export const hashJson = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const chunk = <A>(xs: readonly A[], size: number): A[][] => {
  const out: A[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

/** How one provider sends a request body and returns System One JSON. */
interface Transport {
  readonly name: string;
  /** The most questions in one request. Larger requests are split. */
  readonly maxQuestions: number;
  readonly send: (body: unknown, signal: AbortSignal) => Promise<Response>;
  /** Removes the provider's envelope. Workers AI puts the answer under `result`. */
  readonly unwrap: (json: unknown) => unknown;
  /** Receives every response before its body is read. The hosted endpoint reports the allowance in headers. */
  readonly observe?: (response: Response) => void;
  /** Retries after an `overloaded` error. Defaults to `MAX_RETRIES`. */
  readonly overloadedRetries?: number;
}

const postJson = (url: string, token: string, body: unknown, signal: AbortSignal) =>
  fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

/** The time limit for one HTTP request. A request that times out fails as a network error and is retried. */
const REQUEST_TIMEOUT_MS = 20_000;
/** The longest wait that a Retry-After header can cause. Longer values are cut to this. */
const MAX_RETRY_AFTER_MS = 30_000;

/**
 * Limits the requests in flight per provider. In the extension, the
 * background service worker sends every tab's requests, so the limit covers
 * all tabs. Without it, one page can send a request per table, per label
 * column, and per chunk at once, and exceed the rate limit.
 */
const limiter = (max: number) => {
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (active < max) {
        active++;
        resolve();
      } else {
        waiting.push(() => {
          active++;
          resolve();
        });
      }
    });
  const release = () => {
    active--;
    waiting.shift()?.();
  };
  return { acquire, release };
};
const limiters = new Map<string, ReturnType<typeof limiter>>();
const MAX_IN_FLIGHT = 8;

const retryAfterMs = (response: Response): number | null => {
  const header = response.headers.get("retry-after");
  if (header === null) return null;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : null;
};

const inUnit = (p: number) => Number.isFinite(p) && p >= 0 && p <= 1;

/**
 * Checks a response against the questions asked. Returns null when every
 * question has an answer of the right type, with options from its criteria
 * and probabilities in [0, 1]. Otherwise returns the first problem found.
 * The schema checks the response's shape, not that it matches the request.
 */
export const validateAnswers = (
  questions: Readonly<Record<string, Question>>,
  response: DecisionResponse,
): string | null => {
  for (const [id, q] of Object.entries(questions)) {
    const a = response.answers[id];
    if (a === undefined) return `missing answer for ${id}`;
    if (a.type !== q.type) return `${id}: expected ${q.type}, got ${a.type}`;
    if (a.type === "noul") {
      if (!inUnit(a.noul)) return `${id}: noul ${a.noul} out of range`;
      continue;
    }
    const allowed =
      q.type === "choice" ? Object.keys(q.criteria) : q.type === "score" ? q.criteria.map((_, i) => String(i)) : [];
    for (const [k, p] of Object.entries(a.probabilities)) {
      if (!allowed.includes(k)) return `${id}: unexpected option ${k}`;
      if (!inUnit(p)) return `${id}: probability ${p} out of range`;
    }
  }
  return null;
};

/** Retries after a transient error. */
const MAX_RETRIES = 4;
/** The wait before the first retry. Each later retry waits twice as long, with ±20% jitter. */
const RETRY_BASE_MS = 250;

/** Sends one request body and decodes the response. Does not retry. */
const sendOnce = async (transport: Transport, body: unknown, signal?: AbortSignal): Promise<DecisionResponse> => {
  const gate = limiters.get(transport.name) ?? limiter(MAX_IN_FLIGHT);
  limiters.set(transport.name, gate);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    await gate.acquire();
    try {
      response = await transport.send(body, signal === undefined ? timeout : AbortSignal.any([signal, timeout]));
    } finally {
      gate.release();
    }
  } catch (e) {
    throw new DecisionError({ reason: "network", message: String(e) });
  }
  transport.observe?.(response);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // A spent daily allowance lasts until the reset, so do not wait or retry.
    const spent = response.headers.get("x-practical-data-quota");
    const quota = spent !== null;
    // Wait for Retry-After before the retry backoff adds its own wait.
    const wait = !quota && (response.status === 429 || response.status === 529) ? retryAfterMs(response) : null;
    if (wait !== null) await sleep(wait, signal);
    throw new DecisionError({
      reason: spent === "budget_spent" ? "quota_everyone" : quota ? "quota" : reasonForStatus(response.status),
      message: `${transport.name} ${response.status}: ${text.slice(0, 500)}`,
    });
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (e) {
    throw new DecisionError({ reason: "decode", message: String(e) });
  }
  const decoded = decodeDecisionResponse(transport.unwrap(json));
  if (decoded === null) throw new DecisionError({ reason: "decode", message: "unexpected response shape" });
  return decoded;
};

/**
 * Sends one request body and retries transient errors up to `MAX_RETRIES`
 * times, with exponential backoff. An `overloaded` error is retried at most
 * `transport.overloadedRetries` times. After `signal` aborts, it does not
 * retry.
 */
const send = async (transport: Transport, body: unknown, signal?: AbortSignal): Promise<DecisionResponse> => {
  let overloaded = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      return await sendOnce(transport, body, signal);
    } catch (e) {
      if (!(e instanceof DecisionError) || signal?.aborted === true) throw e;
      const retryable =
        isTransient(e) && (e.reason !== "overloaded" || ++overloaded <= (transport.overloadedRetries ?? MAX_RETRIES));
      if (!retryable || attempt > MAX_RETRIES) throw e;
      const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
      const random = Math.random();
      await sleep(delay * 0.8 * (1 - random) + delay * 1.2 * random, signal);
    }
  }
};

const makeModel = (transport: Transport, cache: AnswerCache = noCache): DecisionModel => ({
  name: transport.name,
  evaluate: async (request, signal) => {
    const parts = chunk(Object.entries(request.questions), transport.maxQuestions);
    const responses = await mapConcurrent(
      parts,
      4,
      async (entries, partSignal) => {
        const body = { model: transport.name, state: request.state, questions: Object.fromEntries(entries) };
        const key = await hashJson(body);
        const questions = Object.fromEntries(entries);
        // Check cached answers again, because storage can hold entries from older code.
        const raw = await cache.get(key);
        partSignal.throwIfAborted();
        const hit = raw === undefined ? null : decodeDecisionResponse(raw);
        if (hit !== null && validateAnswers(questions, hit) === null) return hit;
        const fresh = await send(transport, body, partSignal);
        const invalid = validateAnswers(questions, fresh);
        if (invalid !== null) throw new DecisionError({ reason: "decode", message: invalid });
        await cache.set(key, fresh);
        return fresh;
      },
      signal,
    );
    return {
      model: responses[0]?.model ?? transport.name,
      answers: Object.assign({}, ...responses.map((r) => r.answers)),
      usage: { input_tokens: responses.reduce((n, r) => n + r.usage.input_tokens, 0) },
    } satisfies DecisionResponse;
  },
});

// ── Providers ───────────────────────────────────────────────────────────────

/** The settings that select a provider and its credentials. */
export type ProviderConfig =
  | { readonly provider: "hosted"; readonly installId: string; readonly onAllowance?: (allowance: Allowance) => void }
  | { readonly provider: "jev"; readonly apiKey: string; readonly model?: string }
  | {
      readonly provider: "clef";
      readonly accountId: string;
      readonly apiToken: string;
      readonly model?: "clef" | "clef-flash";
    };

/**
 * TypeSafe's Jev. Requests are split into chunks of 200 questions. The
 * TypeSafe API reference states no question limit, and a body limit of 32 MiB.
 */
export const jev = (
  apiKey: string,
  options: { readonly model?: string | undefined; readonly cache?: AnswerCache | undefined } = {},
) =>
  makeModel(
    {
      name: options.model ?? "jev-latest",
      maxQuestions: 200,
      send: (body, signal) => postJson("https://api.typesafe.ai/v1/systemone", apiKey, body, signal),
      unwrap: (json) => json,
    },
    options.cache,
  );

declare const PD_API_ORIGIN: string | undefined;

/** The hosted endpoint's origin. A build can set `PD_API_ORIGIN` to use a local `wrangler dev`. */
export const API_ORIGIN = typeof PD_API_ORIGIN === "string" ? PD_API_ORIGIN : "https://api.practicaldata.dev";

/** The remaining and total daily allowance of one install on the hosted endpoint. */
export interface Allowance {
  readonly remaining: number;
  readonly limit: number;
}

/** Reads the allowance from a hosted response's headers. Returns null when the headers are missing or invalid. */
export const allowanceOf = (response: Response): Allowance | null => {
  const remaining = Number(response.headers.get("x-practical-data-remaining") ?? NaN);
  const limit = Number(response.headers.get("x-practical-data-limit") ?? NaN);
  return Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0 ? { remaining, limit } : null;
};

/**
 * Jev through the hosted endpoint at api.practicaldata.dev. It needs no API
 * key and has a daily allowance per install. It takes the same request body
 * and the same 200-question chunks as Jev. `onAllowance` receives the
 * allowance from each response that reports one.
 */
export const hosted = (
  installId: string,
  options: {
    readonly onAllowance?: ((allowance: Allowance) => void) | undefined;
    readonly cache?: AnswerCache | undefined;
  } = {},
) =>
  makeModel(
    {
      name: "jev-hosted",
      maxQuestions: 200,
      // The Worker reserves a request from the allowance before it calls Jev, so each
      // retry of an upstream failure (503) spends one more.
      overloadedRetries: 1,
      observe: (response) => {
        const allowance = allowanceOf(response);
        if (allowance !== null) options.onAllowance?.(allowance);
      },
      send: (body, signal) =>
        fetch(`${API_ORIGIN}/v1/systemone`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Practical-Data-Install": installId },
          body: JSON.stringify(body),
          signal,
        }),
      unwrap: (json) => json,
    },
    options.cache,
  );

/** Cloudflare's Clef on Workers AI. The API caps a request at 64 questions. */
export const clef = (
  accountId: string,
  apiToken: string,
  options: { readonly model?: "clef" | "clef-flash" | undefined; readonly cache?: AnswerCache | undefined } = {},
) => {
  const model = options.model ?? "clef";
  // Account IDs are 32 hex characters. Encode anything else so that it cannot change the URL path.
  const account = /^[0-9a-f]{32}$/i.test(accountId) ? accountId : encodeURIComponent(accountId);
  return makeModel(
    {
      name: model,
      maxQuestions: 64,
      send: (body, signal) =>
        postJson(
          `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${model}`,
          apiToken,
          body,
          signal,
        ),
      unwrap: (json) => (typeof json === "object" && json !== null && "result" in json ? json.result : json),
    },
    options.cache,
  );
};

/** Returns the `DecisionModel` for `config`, with `cache` in front of the provider. */
export const modelFromConfig = (config: ProviderConfig, cache?: AnswerCache): DecisionModel =>
  config.provider === "hosted"
    ? hosted(config.installId, { onAllowance: config.onAllowance, cache })
    : config.provider === "jev"
      ? jev(config.apiKey, { model: config.model, cache })
      : clef(config.accountId, config.apiToken, { model: config.model, cache });
