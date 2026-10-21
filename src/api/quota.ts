/**
 * Daily allowances for the hosted endpoint. One Durable Object per UTC day
 * holds that day's counts. It counts the requests from each install and the
 * input tokens that all installs spend. Each day uses a new object, so the
 * counts reset with no cleanup job. An alarm deletes each object's storage
 * two days after its first reservation. The SQL is in counts.ts.
 */
import { DurableObject } from "cloudflare:workers";
import {
  charge,
  createTables,
  release,
  reserve,
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

  /** Counts one model request for `install`, unless today's allowance is used up. */
  async reserve(install: string, allowance: Allowance): Promise<Reservation> {
    this.#init();
    const reservation = reserve(this.ctx.storage.sql, install, allowance);
    if (reservation.status === "ok" && (await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
    return reservation;
  }

  /** Gives back a request that `reserve` counted, when the upstream call failed. */
  release(install: string): void {
    this.#init();
    release(this.ctx.storage.sql, install);
  }

  /** Adds the input tokens that a forwarded request used. */
  charge(tokens: number): void {
    this.#init();
    charge(this.ctx.storage.sql, tokens);
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
