/**
 * Daily allowances for the hosted endpoint. One Durable Object per UTC day
 * holds that day's counts. It counts the requests from each install and the
 * input tokens that all installs spend. Each day uses a new object, so the
 * counts reset with no cleanup job. An alarm deletes each object's storage
 * two days after its first reservation.
 */
import { DurableObject } from "cloudflare:workers";

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

const KEEP_MS = 2 * 24 * 60 * 60 * 1000;

/** The counts for one UTC day. */
export class Quota extends DurableObject {
  #ready = false;

  #init() {
    if (this.#ready) return;
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS installs (id TEXT PRIMARY KEY, requests INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS totals (name TEXT PRIMARY KEY, value INTEGER NOT NULL)");
    this.#ready = true;
  }

  /**
   * Counts one model request for `install`, unless today's allowance is used
   * up. The read and the write run with no await between them, so two
   * concurrent calls cannot both take the last request.
   */
  async reserve(install: string, allowance: Allowance): Promise<Reservation> {
    this.#init();
    const sql = this.ctx.storage.sql;
    const spent =
      sql.exec<{ value: number }>("SELECT value FROM totals WHERE name = 'tokens'").toArray()[0]?.value ?? 0;
    const used =
      sql.exec<{ requests: number }>("SELECT requests FROM installs WHERE id = ?", install).toArray()[0]?.requests ?? 0;
    const left = Math.max(0, allowance.installRequests - used);
    if (spent >= allowance.tokenBudget) return { status: "budget_spent", remaining: left };
    if (left === 0) return { status: "install_limit", remaining: 0 };
    sql.exec(
      "INSERT INTO installs (id, requests) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET requests = requests + 1",
      install,
    );
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
    return { status: "ok", remaining: left - 1 };
  }

  /**
   * Adds the input tokens that a forwarded request used. The Worker charges
   * tokens after the response arrives, so requests in flight can take the
   * total past the budget.
   */
  charge(tokens: number): void {
    this.#init();
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    this.ctx.storage.sql.exec(
      "INSERT INTO totals (name, value) VALUES ('tokens', ?) ON CONFLICT(name) DO UPDATE SET value = value + excluded.value",
      Math.round(tokens),
    );
  }

  /** Today's totals, for the operator. */
  stats(): { installs: number; requests: number; tokens: number } {
    this.#init();
    const sql = this.ctx.storage.sql;
    const i = sql.exec<{ n: number; r: number | null }>("SELECT COUNT(*) AS n, SUM(requests) AS r FROM installs").one();
    const tokens =
      sql.exec<{ value: number }>("SELECT value FROM totals WHERE name = 'tokens'").toArray()[0]?.value ?? 0;
    return { installs: i.n, requests: i.r ?? 0, tokens };
  }

  /** Deletes the day's counts. */
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
