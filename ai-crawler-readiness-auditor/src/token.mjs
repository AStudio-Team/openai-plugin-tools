import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const secret = process.env.CHECKPOINT_SIGNING_SECRET
  ? Buffer.from(process.env.CHECKPOINT_SIGNING_SECRET, "utf8")
  : randomBytes(32);

function encode(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function sign(encoded) { return createHmac("sha256", secret).update(encoded).digest("base64url"); }

export function createCheckpoint(payload, now = Date.now()) {
  const claims = { ...payload, exp: now + 15 * 60_000, nonce: randomBytes(16).toString("hex") };
  const encoded = encode(claims);
  return { token: `${encoded}.${sign(encoded)}`, expiresAt: new Date(claims.exp).toISOString() };
}

export function verifyCheckpoint(token, expected, now = Date.now()) {
  if (typeof token !== "string" || token.length > 4096) throw new Error("Invalid checkpoint token.");
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) throw new Error("Invalid checkpoint token.");
  const calculated = Buffer.from(sign(encoded));
  const supplied = Buffer.from(signature);
  if (calculated.length !== supplied.length || !timingSafeEqual(calculated, supplied)) throw new Error("Invalid checkpoint token.");
  let claims;
  try { claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw new Error("Invalid checkpoint token."); }
  if (!Number.isFinite(claims.exp) || claims.exp <= now) throw new Error("The checkpoint expired. Validate the URL again.");
  for (const key of ["url", "origin", "scope"]) if (claims[key] !== expected[key]) throw new Error("The checkpoint does not match the requested audit.");
  if (JSON.stringify(claims.checks) !== JSON.stringify(expected.checks)) throw new Error("The checkpoint does not match the selected checks.");
  return claims;
}
