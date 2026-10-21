/**
 * Daily allowances for the hosted endpoint. One Durable Object per UTC day
 * holds that day's counts. It counts the requests from each install and the
 * input tokens that all installs spend. Each day uses a new object, so the
 * counts reset with no cleanup job. An alarm deletes each object's storage
 * two days after its first reservation. The SQL is in counts.ts.
 */
import { DurableObject } from "cloudflare:workers";
import {
  createTables,
  release,
  reserve,
  settle,
  stats,
  type Allowance,
  type Reservation,
  type Stats,
} from "./counts.ts";

export type { Allowance, Reservation } from "./counts.ts";

const KEEP_MS = 2 * 24 * 60 * 60 * 1000;

/** The counts for one UTC day. */
export class Quota extends DurableObject {
  #ready = false;

  #init() {
    if (this.#ready) return;
    createTables(this.ctx.storage.sql);
    this.#ready = true;
  }

  /** Counts one model request and its estimated input tokens, unless today's allowance is used up. */
  async reserve(install: string, allowance: Allowance, estimate: number): Promise<Reservation> {
    this.#init();
    const reservation = reserve(this.ctx.storage.sql, install, allowance, estimate);
    if (reservation.status === "ok" && (await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
    return reservation;
  }

  /** Gives back a request and its estimated tokens, when the upstream call failed. */
  release(install: string, estimate: number): void {
    this.#init();
    release(this.ctx.storage.sql, install, estimate);
  }

  /** Replaces a request's estimated tokens with the input tokens it used. */
  settle(estimate: number, used: number): void {
    this.#init();
    settle(this.ctx.storage.sql, estimate, used);
  }

  /** Today's totals, for the operator. */
  stats(): Stats {
    this.#init();
    return stats(this.ctx.storage.sql);
  }

  /** Deletes the day's counts. */
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
