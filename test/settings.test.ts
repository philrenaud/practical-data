import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, isPrivateHost, setSiteEnabledIn, siteEnabled } from "../src/ext/settings.ts";

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
