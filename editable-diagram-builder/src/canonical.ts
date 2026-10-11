import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function normalizeString(value: string): string { return value.normalize("NFC").replace(/\r\n?/g, "\n").trim(); }
export function canonicalize(value: unknown): unknown {
  if (typeof value === "string") return normalizeString(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize((value as Record<string, unknown>)[key])]));
  if (typeof value === "number") return Number(value.toFixed(3));
  return value;
}
export function stableJson(value: unknown): string { return `${JSON.stringify(canonicalize(value), null, 2)}\n`; }
export function digest(value: unknown): string { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function secret(): string {
  const value = process.env.CHECKPOINT_SECRET;
  if (value && Buffer.byteLength(value) >= 32) return value;
  if (process.env.NODE_ENV === "production") throw new Error("CHECKPOINT_SECRET must contain at least 32 bytes");
  return "local-development-checkpoint-secret-change-me";
}
export function issueCheckpoint(briefDigest: string, now = Date.now()): { checkpointToken: string; expiresAt: string } {
  const payload = { digest: briefDigest, iat: now, exp: now + 30 * 60_000, v: 1 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(body).digest("base64url");
  return { checkpointToken: `${body}.${signature}`, expiresAt: new Date(payload.exp).toISOString() };
}
export function verifyCheckpoint(token: string, expectedDigest: string, now = Date.now()): void {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw new Error("Invalid checkpoint token");
  const calculated = createHmac("sha256", secret()).update(body).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { throw new Error("Invalid checkpoint token"); }
  if (supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated)) throw new Error("Invalid checkpoint signature");
  let payload: { digest?: string; exp?: number; v?: number };
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { throw new Error("Invalid checkpoint payload"); }
  if (payload.v !== 1 || payload.digest !== expectedDigest) throw new Error("Checkpoint does not match this brief");
  if (!Number.isSafeInteger(payload.exp) || (payload.exp as number) <= now) throw new Error("Checkpoint expired; reconfirm the brief");
}
