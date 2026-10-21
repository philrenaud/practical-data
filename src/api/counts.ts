/**
 * The SQL behind the `Quota` Durable Object, kept apart from the Workers
 * runtime so that tests can run it on node:sqlite. Every function is
 * synchronous. A Durable Object therefore runs each one to completion before
 * it handles another call.
 */

/** The SQL interface of Durable Object storage. */
export type Sql = DurableObjectState["storage"]["sql"];

export interface Allowance {
  /** The number of model requests that one install may make per day. Cache hits do not count. */
  readonly installRequests: number;
  /** The number of input tokens that all installs together may spend per day. */
  readonly tokenBudget: number;
}

export interface Reservation {
  readonly status: "ok" | "install_limit" | "budget_spent";
  /** The number of requests this install has left today, after this one. */
  readonly remaining: number;
}

export interface Stats {
  readonly installs: number;
  readonly requests: number;
  readonly tokens: number;
}

/** Creates the tables if they do not exist. */
export const createTables = (sql: Sql): void => {
  sql.exec("CREATE TABLE IF NOT EXISTS installs (id TEXT PRIMARY KEY, requests INTEGER NOT NULL)");
  sql.exec("CREATE TABLE IF NOT EXISTS totals (name TEXT PRIMARY KEY, value INTEGER NOT NULL)");
};

const tokens = (sql: Sql): number =>
  sql.exec<{ value: number }>("SELECT value FROM totals WHERE name = 'tokens'").toArray()[0]?.value ?? 0;

const addTokens = (sql: Sql, n: number): void => {
  sql.exec(
    "INSERT INTO totals (name, value) VALUES ('tokens', ?) ON CONFLICT(name) DO UPDATE SET value = value + excluded.value",
    n,
  );
};

const requests = (sql: Sql, install: string): number =>
  sql.exec<{ requests: number }>("SELECT requests FROM installs WHERE id = ?", install).toArray()[0]?.requests ?? 0;

/**
 * Counts one model request for `install`, unless today's allowance is used
 * up. It also adds `estimate` input tokens to the day's total at once, so
 * that requests in flight count against the budget. If the estimate is not
 * below the real usage, the day's total passes the budget by at most the one
 * request that crosses it.
 */
export const reserve = (sql: Sql, install: string, allowance: Allowance, estimate: number): Reservation => {
  const left = Math.max(0, allowance.installRequests - requests(sql, install));
  if (tokens(sql) >= allowance.tokenBudget) return { status: "budget_spent", remaining: left };
  if (left === 0) return { status: "install_limit", remaining: 0 };
  sql.exec(
    "INSERT INTO installs (id, requests) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET requests = requests + 1",
    install,
  );
  addTokens(sql, estimate);
  return { status: "ok", remaining: left - 1 };
};

/** Gives back a request and its estimated tokens, when the upstream call failed. */
export const release = (sql: Sql, install: string, estimate: number): void => {
  if (requests(sql, install) === 0) return;
  sql.exec("UPDATE installs SET requests = requests - 1 WHERE id = ?", install);
  addTokens(sql, -estimate);
};

/** Replaces a request's estimated tokens with the input tokens it used. */
export const settle = (sql: Sql, estimate: number, used: number): void => {
  if (!Number.isFinite(used) || used < 0) return;
  addTokens(sql, Math.round(used) - estimate);
};

/** Today's totals, for the operator. */
export const stats = (sql: Sql): Stats => {
  const i = sql.exec<{ n: number; r: number | null }>("SELECT COUNT(*) AS n, SUM(requests) AS r FROM installs").one();
  return { installs: i.n, requests: i.r ?? 0, tokens: tokens(sql) };
};
