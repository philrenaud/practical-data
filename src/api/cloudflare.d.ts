/**
 * The few Workers runtime types the API uses, declared here instead of
 * depending on @cloudflare/workers-types.
 */

declare module "cloudflare:workers" {
  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}

interface SqlCursor<T> {
  toArray(): T[];
  one(): T;
}

interface DurableObjectState {
  readonly storage: {
    readonly sql: { exec<T = Record<string, number | string | null>>(query: string, ...bindings: unknown[]): SqlCursor<T> };
    getAlarm(): Promise<number | null>;
    setAlarm(at: number): Promise<void>;
    deleteAll(): Promise<void>;
  };
}

interface DurableObjectNamespace<T> {
  idFromName(name: string): unknown;
  get(id: unknown): T;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface CacheStorage {
  readonly default: Cache;
}
