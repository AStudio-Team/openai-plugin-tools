import assert from "node:assert/strict";
import test from "node:test";
import { EncryptedReportStore } from "../src/store.mjs";

test("stores ciphertext, expires reports and does not extend expiry on update", () => {
  let now = 1_000;
  const store = new EncryptedReportStore({ ttlMs: 100, now: () => now });
  const stored = store.put({ payload: "private-product-name" });
  const raw = store.records.get(stored.report_id);
  assert.equal(raw.encrypted.includes(Buffer.from("private-product-name")), false);
  const originalExpiry = stored.expires_at;
  now = 1_050;
  const updated = store.update(stored.report_id, { payload: "updated" });
  assert.equal(updated.expires_at, originalExpiry);
  assert.equal(store.get(stored.report_id).payload, "updated");
  now = 1_101;
  assert.equal(store.get(stored.report_id), null);
});