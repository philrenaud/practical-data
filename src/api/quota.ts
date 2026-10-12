/**
 * Daily allowances for the hosted endpoint. One Durable Object per UTC day
 * holds that day's counts: requests per install, and input tokens spent in
 * total. A new day is a new object, so counts reset without a sweep; each
 * object deletes itself two days later.
 */
import { DurableObject } from "cloudflare:workers";

export interface Allowance {
  /** Requests one install may send to the model per day (cache hits don't count). */
  readonly installRequests: number;
  /** Input tokens all installs together may spend per day. */
  readonly tokenBudget: number;
}

export type Reservation = "ok" | "install_limit" | "budget_spent";

const KEEP_MS = 2 * 24 * 60 * 60 * 1000;

export class Quota extends DurableObject {
  #ready = false;

  #init() {
    if (this.#ready) return;
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS installs (id TEXT PRIMARY KEY, requests INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS totals (name TEXT PRIMARY KEY, value INTEGER NOT NULL)");
    this.#ready = true;
  }

  /** Counts one model request for `install`, unless today's allowance is used up. */
  async reserve(install: string, allowance: Allowance): Promise<Reservation> {
    this.#init();
    const sql = this.ctx.storage.sql;
    const spent = sql.exec<{ value: number }>("SELECT value FROM totals WHERE name = 'tokens'").toArray()[0]?.value ?? 0;
    if (spent >= allowance.tokenBudget) return "budget_spent";
    const used = sql.exec<{ requests: number }>("SELECT requests FROM installs WHERE id = ?", install).toArray()[0]?.requests ?? 0;
    if (used >= allowance.installRequests) return "install_limit";
    sql.exec(
      "INSERT INTO installs (id, requests) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET requests = requests + 1",
      install,
    );
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
    return "ok";
  }

  /** Adds the input tokens a forwarded request actually used. */
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
    const tokens = sql.exec<{ value: number }>("SELECT value FROM totals WHERE name = 'tokens'").toArray()[0]?.value ?? 0;
    return { installs: i.n, requests: i.r ?? 0, tokens };
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
