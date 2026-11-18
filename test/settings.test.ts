import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  isPrivateHost,
  pageRangesKey,
  putPageRanges,
  setSiteEnabledIn,
  siteEnabled,
} from "../src/ext/settings.ts";

test("local and private-network hosts are private", () => {
  for (const host of [
    "localhost",
    "app.localhost",
    "intranet",
    "nas.local",
    "grafana.internal",
    "router.lan",
    "wiki.corp",
    "printer.home.arpa",
    "127.0.0.1",
    "10.0.4.2",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.10.10",
    "100.64.0.1",
    "100.127.255.255",
    "[::1]",
    "[fd12:3456::1]",
    "[fe80::1]",
  ]) {
    assert.equal(isPrivateHost(host), true, host);
  }
});

test("public hosts are not private", () => {
  for (const host of [
    "en.wikipedia.org",
    "docs.github.com",
    "local.example.com",
    "internal.example.com",
    "8.8.8.8",
    "172.32.0.1",
    "172.15.0.1",
    "100.128.0.1",
    "192.169.0.1",
    "[2606:4700::1111]",
    "",
  ]) {
    assert.equal(isPrivateHost(host), false, host);
  }
});

test("in every-site mode, a private host is off until the user turns it on", () => {
  const s = DEFAULT_SETTINGS;
  assert.equal(siteEnabled(s, "en.wikipedia.org"), true);
  assert.equal(siteEnabled(s, "grafana.internal"), false);
  const on = setSiteEnabledIn(s, "grafana.internal", true);
  assert.equal(siteEnabled(on, "grafana.internal"), true);
  assert.equal(siteEnabled(setSiteEnabledIn(on, "grafana.internal", false), "grafana.internal"), false);
});

test("turning a public host off and on again in every-site mode", () => {
  const off = setSiteEnabledIn(DEFAULT_SETTINGS, "news.ycombinator.com", false);
  assert.equal(siteEnabled(off, "news.ycombinator.com"), false);
  assert.deepEqual(off.disabledHosts, ["news.ycombinator.com"]);
  const on = setSiteEnabledIn(off, "news.ycombinator.com", true);
  assert.equal(siteEnabled(on, "news.ycombinator.com"), true);
  assert.deepEqual(on.disabledHosts, []);
  assert.deepEqual(on.enabledHosts, []);
});

test("in chosen-sites mode, private and public hosts are off until the user turns them on", () => {
  const s = { ...DEFAULT_SETTINGS, mode: "chosen" as const };
  assert.equal(siteEnabled(s, "en.wikipedia.org"), false);
  assert.equal(siteEnabled(s, "localhost"), false);
  assert.equal(siteEnabled(setSiteEnabledIn(s, "localhost", true), "localhost"), true);
});

const RANGES = { shared: {}, tables: { k: { "Win rate": [0, 100] as const } } };

test("a page's ranges are stored with the time they were saved", () => {
  assert.deepEqual(putPageRanges({}, "p1", RANGES, 1000), { p1: { at: 1000, ranges: RANGES } });
});

test("saving empty ranges removes the page", () => {
  const store = putPageRanges({}, "p1", RANGES, 1000);
  assert.deepEqual(putPageRanges(store, "p1", { shared: {}, tables: {} }, 2000), {});
});

test("past the cap, the pages saved longest ago are dropped", () => {
  let store = {};
  for (let i = 0; i < 5; i++) store = putPageRanges(store, `p${i}`, RANGES, 1000 + i, 3);
  assert.deepEqual(Object.keys(store).sort(), ["p2", "p3", "p4"]);
  // Saving a page again makes it the newest.
  store = putPageRanges(store, "p2", RANGES, 2000, 3);
  store = putPageRanges(store, "p9", RANGES, 2001, 3);
  assert.deepEqual(Object.keys(store).sort(), ["p2", "p4", "p9"]);
});

test("a page's storage key hides its address and ignores the fragment", async () => {
  const key = await pageRangesKey("https://example.com/standings?year=2026#west");
  assert.match(key, /^[0-9a-f]{24}$/);
  assert.equal(await pageRangesKey("https://example.com/standings?year=2026#east"), key);
  assert.notEqual(await pageRangesKey("https://example.com/standings?year=2025"), key);
});
