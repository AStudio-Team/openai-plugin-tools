import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpoint, verifyCheckpoint } from "../src/token.mjs";

const claims = { url: "https://example.com/page", origin: "https://example.com", scope: "page_and_site_controls", checks: ["target_fetch"] };

test("checkpoint is bound to exact URL, origin, scope, checks, and expiry", () => {
  const now = 1_000_000;
  const checkpoint = createCheckpoint(claims, now);
  const verified = verifyCheckpoint(checkpoint.token, claims, now + 1);
  assert.deepEqual({ ...verified, nonce: undefined }, { ...claims, exp: now + 15 * 60_000, nonce: undefined });
  assert.match(verified.nonce, /^[a-f0-9]{32}$/);
});

test("checkpoint rejects tampering, changed scope, changed checks, and expiry", () => {
  const now = 2_000_000;
  const checkpoint = createCheckpoint(claims, now);
  assert.throws(() => verifyCheckpoint(`${checkpoint.token}x`, claims, now));
  assert.throws(() => verifyCheckpoint(checkpoint.token, { ...claims, scope: "site_controls_only" }, now));
  assert.throws(() => verifyCheckpoint(checkpoint.token, { ...claims, checks: ["robots_access"] }, now));
  assert.throws(() => verifyCheckpoint(checkpoint.token, claims, now + 15 * 60_000));
});
