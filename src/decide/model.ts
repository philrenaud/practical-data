/**
 * The decision-model boundary. Jev (TypeSafe) and Clef (Cloudflare Workers AI)
 * share one request/answer contract, so each provider is just a transport plus
 * a question-count limit. Everything past this file sees decoded, typed answers.
 */
import { Context, Data, Effect, Layer, Schedule, Schema } from "effect";

// ── Request ─────────────────────────────────────────────────────────────────

/** Instructions and criteria accept strings or JSON structure (see TypeSafe "Advanced: structure"). */
export type Prose = string | Readonly<Record<string, unknown>> | readonly unknown[];

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

export interface DecisionRequest {
  readonly state: unknown;
  readonly questions: Readonly<Record<string, Question>>;
}

// ── Response ────────────────────────────────────────────────────────────────

const Probabilities = Schema.Record(Schema.String, Schema.Number);

export const Answer = Schema.Union([
  Schema.Struct({ type: Schema.Literal("noul"), noul: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal("choice"),
    choice: Schema.String,
    probabilities: Probabilities,
    confidence: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    score: Schema.Number,
    probabilities: Probabilities,
    confidence: Schema.Number,
  }),
]);
export type Answer = typeof Answer.Type;

export const DecisionResponse = Schema.Struct({
  model: Schema.String,
  answers: Schema.Record(Schema.String, Answer),
  usage: Schema.Struct({ input_tokens: Schema.Number }),
});
export type DecisionResponse = typeof DecisionResponse.Type;

// ── Errors ──────────────────────────────────────────────────────────────────

export type DecisionErrorReason =
  | "auth"
  | "rate_limited"
  | "overloaded"
  | "bad_request"
  | "network"
  | "decode"
  | "missing_config";

export class DecisionError extends Data.TaggedError("DecisionError")<{
  readonly reason: DecisionErrorReason;
  readonly message: string;
}> {}

const isTransient = (e: DecisionError): boolean =>
  e.reason === "rate_limited" || e.reason === "overloaded" || e.reason === "network";

const reasonForStatus = (status: number): DecisionErrorReason =>
  status === 401 || status === 403
    ? "auth"
    : status === 429
      ? "rate_limited"
      : status === 529 || status >= 500
        ? "overloaded"
        : "bad_request";

// ── Service ─────────────────────────────────────────────────────────────────

export class DecisionModel extends Context.Service<
  DecisionModel,
  {
    /** Provider/model label, e.g. "jev-latest" or "clef". */
    readonly name: string;
    /** Evaluates any number of questions; chunks to the provider's per-request limit. */
    readonly evaluate: (request: DecisionRequest) => Effect.Effect<DecisionResponse, DecisionError>;
  }
>()("practical-data/DecisionModel") {}

/**
 * Optional persistent cache of raw answers keyed by request hash. Defaults to
 * no caching. The extension backs it with chrome.storage; the eval harness
 * backs it with files on disk so test runs are reproducible offline.
 */
export const AnswerCache = Context.Reference<{
  readonly get: (key: string) => Effect.Effect<DecisionResponse | undefined>;
  readonly set: (key: string, value: DecisionResponse) => Effect.Effect<void>;
}>("practical-data/AnswerCache", {
  defaultValue: () => ({
    get: () => Effect.succeed(undefined),
    set: () => Effect.void,
  }),
});

/** sha-256 of a JSON value, hex encoded. Works in service workers and Node. */
export const hashJson = (value: unknown): Effect.Effect<string> =>
  Effect.promise(async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  });

const chunk = <A>(xs: readonly A[], size: number): A[][] => {
  const out: A[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

const decode = Schema.decodeUnknownEffect(DecisionResponse);

/** A provider: how to send one request body and get back the System One JSON. */
interface Transport {
  readonly name: string;
  readonly maxQuestions: number;
  readonly send: (body: unknown, signal: AbortSignal) => Promise<Response>;
  /** Unwraps the provider envelope (Workers AI nests the answer under `result`). */
  readonly unwrap: (json: unknown) => unknown;
}

const postJson = (url: string, token: string, body: unknown, signal: AbortSignal) =>
  fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

/** Per-request time limit. A hung connection fails as a (retryable) network error. */
const REQUEST_TIMEOUT_MS = 20_000;
/** Longest Retry-After the client will honor before giving up on that attempt. */
const MAX_RETRY_AFTER_MS = 30_000;

/**
 * Shared cap on in-flight requests per provider, across every tab: page fan-out
 * (tables × label columns × chunks) can otherwise exceed the rate limit at once.
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
 * Checks the answers against the questions asked: every id present, the
 * right type, choice keys drawn from the criteria, probabilities in [0, 1].
 * Typed output guarantees a shape, not that the shape matches the request.
 */
export const validateAnswers = (questions: Readonly<Record<string, Question>>, response: DecisionResponse): string | null => {
  for (const [id, q] of Object.entries(questions)) {
    const a = response.answers[id];
    if (a === undefined) return `missing answer for ${id}`;
    if (a.type !== q.type) return `${id}: expected ${q.type}, got ${a.type}`;
    if (a.type === "noul") {
      if (!inUnit(a.noul)) return `${id}: noul ${a.noul} out of range`;
      continue;
    }
    const allowed = q.type === "choice" ? Object.keys(q.criteria) : q.type === "score" ? q.criteria.map((_, i) => String(i)) : [];
    for (const [k, p] of Object.entries(a.probabilities)) {
      if (!allowed.includes(k)) return `${id}: unexpected option ${k}`;
      if (!inUnit(p)) return `${id}: probability ${p} out of range`;
    }
  }
  return null;
};

const sendOnce = (transport: Transport, body: unknown) =>
  Effect.gen(function* () {
    const gate = limiters.get(transport.name) ?? limiter(MAX_IN_FLIGHT);
    limiters.set(transport.name, gate);
    const response = yield* Effect.tryPromise({
      try: async (signal) => {
        await gate.acquire();
        try {
          return await transport.send(body, AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]));
        } finally {
          gate.release();
        }
      },
      catch: (e) => new DecisionError({ reason: "network", message: String(e) }),
    });
    if (!response.ok) {
      const text = yield* Effect.promise(() => response.text().catch(() => ""));
      // Honor the server's pacing before the retry schedule's own backoff.
      const wait = response.status === 429 || response.status === 529 ? retryAfterMs(response) : null;
      if (wait !== null) yield* Effect.sleep(wait);
      return yield* new DecisionError({
        reason: reasonForStatus(response.status),
        message: `${transport.name} ${response.status}: ${text.slice(0, 500)}`,
      });
    }
    const json = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (e) => new DecisionError({ reason: "decode", message: String(e) }),
    });
    return yield* decode(transport.unwrap(json)).pipe(
      Effect.mapError((e) => new DecisionError({ reason: "decode", message: String(e) })),
    );
  }).pipe(
    Effect.retry({
      while: isTransient,
      schedule: Schedule.exponential("250 millis").pipe(Schedule.jittered),
      times: 4,
    }),
  );

const makeModel = (transport: Transport) =>
  DecisionModel.of({
    name: transport.name,
    evaluate: (request) =>
      Effect.gen(function* () {
        const cache = yield* AnswerCache;
        const parts = chunk(Object.entries(request.questions), transport.maxQuestions);
        const responses = yield* Effect.forEach(
          parts,
          (entries) =>
            Effect.gen(function* () {
              const body = { model: transport.name, state: request.state, questions: Object.fromEntries(entries) };
              const key = yield* hashJson(body);
              const questions = Object.fromEntries(entries);
              // Cached answers are re-checked: storage can hold entries from older code.
              const raw = yield* cache.get(key);
              const hit = raw === undefined ? undefined : Schema.decodeUnknownOption(DecisionResponse)(raw);
              if (hit !== undefined && hit._tag === "Some" && validateAnswers(questions, hit.value) === null) {
                return hit.value;
              }
              const fresh = yield* sendOnce(transport, body);
              const invalid = validateAnswers(questions, fresh);
              if (invalid !== null) return yield* new DecisionError({ reason: "decode", message: invalid });
              yield* cache.set(key, fresh);
              return fresh;
            }),
          { concurrency: 4 },
        );
        return {
          model: responses[0]?.model ?? transport.name,
          answers: Object.assign({}, ...responses.map((r) => r.answers)),
          usage: { input_tokens: responses.reduce((n, r) => n + r.usage.input_tokens, 0) },
        } satisfies DecisionResponse;
      }),
  });

// ── Providers ───────────────────────────────────────────────────────────────

export type ProviderConfig =
  | { readonly provider: "jev"; readonly apiKey: string; readonly model?: string }
  | {
      readonly provider: "clef";
      readonly accountId: string;
      readonly apiToken: string;
      readonly model?: "clef" | "clef-flash";
    };

/** TypeSafe's Jev. No documented question cap; 200 keeps requests well inside the 64k budget. */
export const jev = (apiKey: string, model = "jev-latest") =>
  makeModel({
    name: model,
    maxQuestions: 200,
    send: (body, signal) => postJson("https://api.typesafe.ai/v1/systemone", apiKey, body, signal),
    unwrap: (json) => json,
  });

/** Cloudflare's Clef on Workers AI. The API caps a request at 64 questions. */
export const clef = (accountId: string, apiToken: string, model: "clef" | "clef-flash" = "clef") => {
  // Account IDs are 32 hex characters; anything else would end up in the URL path.
  const account = /^[0-9a-f]{32}$/i.test(accountId) ? accountId : encodeURIComponent(accountId);
  return makeModel({
    name: model,
    maxQuestions: 64,
    send: (body, signal) =>
      postJson(
        `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${model}`,
        apiToken,
        body,
        signal,
      ),
    unwrap: (json) =>
      typeof json === "object" && json !== null && "result" in json ? json.result : json,
  });
};

export const layerFromConfig = (config: ProviderConfig): Layer.Layer<DecisionModel> =>
  Layer.succeed(
    DecisionModel,
    config.provider === "jev"
      ? jev(config.apiKey, config.model)
      : clef(config.accountId, config.apiToken, config.model),
  );
