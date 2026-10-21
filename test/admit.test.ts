import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimitKey, sameSecret } from "../src/api/admit.ts";

test("rate-limits an IPv6 address by its /64 prefix", () => {
  const key = "2001:db8:1:2::/64";
  assert.equal(rateLimitKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), key);
  assert.equal(rateLimitKey("2001:0DB8:0001:0002:ffff:ffff:ffff:ffff"), key);
  assert.equal(rateLimitKey("2001:db8:1:2::1"), key);
  assert.equal(rateLimitKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(rateLimitKey("::1"), "0:0:0:0::/64");
});

test("rate-limits an IPv4 address by the whole address", () => {
  assert.equal(rateLimitKey("203.0.113.5"), "203.0.113.5");
  assert.equal(rateLimitKey("::ffff:203.0.113.5"), "203.0.113.5");
  assert.equal(rateLimitKey("unknown"), "unknown");
});

test("compares a bearer token with the secret", async () => {
  assert.equal(await sameSecret("Bearer s3cret", "s3cret"), true);
  assert.equal(await sameSecret("Bearer s3cres", "s3cret"), false);
  assert.equal(await sameSecret("Bearer s3cret-and-more", "s3cret"), false);
  assert.equal(await sameSecret("s3cret", "s3cret"), false);
  assert.equal(await sameSecret(null, "s3cret"), false);
  // With no secret set, nothing passes.
  assert.equal(await sameSecret("Bearer ", ""), false);
});
