import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createTables, release, reserve, settle, stats, type Sql } from "../src/api/counts.ts";

/** Durable Object SQL storage, backed by an in-memory node:sqlite database. */
const memorySql = (): Sql => {
  const db = new DatabaseSync(":memory:");
  const sql: Sql = {
    exec: <T>(query: string, ...bindings: unknown[]) => {
      const rows = db.prepare(query).all(...(bindings as (string | number)[])) as T[];
      return { toArray: () => rows, one: () => rows[0]! };
    },
  };
  createTables(sql);
  return sql;
};

const allowance = { installRequests: 3, tokenBudget: 1000 };

test("counts requests per install up to the daily limit", () => {
  const sql = memorySql();
  assert.deepEqual(
    [1, 2, 3, 4].map(() => reserve(sql, "a", allowance, 0)),
    [
      { status: "ok", remaining: 2 },
      { status: "ok", remaining: 1 },
      { status: "ok", remaining: 0 },
      { status: "install_limit", remaining: 0 },
    ],
  );
  assert.deepEqual(reserve(sql, "b", allowance, 0), { status: "ok", remaining: 2 });
  assert.deepEqual(stats(sql), { installs: 2, requests: 4, tokens: 0 });
});

test("gives back a request that failed upstream, with its estimated tokens", () => {
  const sql = memorySql();
  for (let i = 0; i < 3; i++) reserve(sql, "a", allowance, 100);
  release(sql, "a", 100);
  assert.deepEqual(reserve(sql, "a", allowance, 100), { status: "ok", remaining: 0 });
  // A release with nothing reserved changes nothing.
  release(sql, "b", 100);
  assert.deepEqual(stats(sql), { installs: 1, requests: 3, tokens: 300 });
});

test("refuses every install once the token budget is spent", () => {
  const sql = memorySql();
  reserve(sql, "a", allowance, 400);
  settle(sql, 400, 1000);
  assert.deepEqual(reserve(sql, "b", allowance, 0), { status: "budget_spent", remaining: 3 });
  assert.deepEqual(stats(sql), { installs: 1, requests: 1, tokens: 1000 });
});

test("counts estimated tokens for requests in flight against the budget", () => {
  const sql = memorySql();
  assert.equal(reserve(sql, "a", allowance, 600).status, "ok");
  assert.equal(reserve(sql, "b", allowance, 600).status, "ok");
  // Neither request has finished, but their estimates already count.
  assert.equal(reserve(sql, "c", allowance, 600).status, "budget_spent");
  // The real usage replaces each estimate.
  settle(sql, 600, 250);
  settle(sql, 600, 250);
  assert.equal(stats(sql).tokens, 500);
  assert.equal(reserve(sql, "c", allowance, 600).status, "ok");
});
