import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

export const REPORT_TTL_MS = 30 * 60 * 1000;

export class EncryptedReportStore {
  constructor({ ttlMs = REPORT_TTL_MS, key = randomBytes(32), now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.key = key;
    this.now = now;
    this.records = new Map();
  }

  put(report) {
    const id = report.report_id || randomUUID();
    const createdAt = this.now();
    const expiresAt = createdAt + this.ttlMs;
    return this.#write(id, report, expiresAt);
  }

  update(id, report) {
    this.prune();
    const existing = this.records.get(id);
    if (!existing) return null;
    return this.#write(id, report, existing.expiresAt);
  }

  #write(id, report, expiresAt) {
    const previous = this.records.get(id);
    if (previous?.timer) clearTimeout(previous.timer);
    const value = { ...report, report_id: id, expires_at: new Date(expiresAt).toISOString() };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    const timer = setTimeout(() => this.records.delete(id), Math.max(0, expiresAt - this.now()));
    timer.unref();
    this.records.set(id, { iv, tag: cipher.getAuthTag(), encrypted, expiresAt, timer });
    return value;
  }

  get(id) {
    this.prune();
    const record = this.records.get(id);
    if (!record) return null;
    const decipher = createDecipheriv("aes-256-gcm", this.key, record.iv);
    decipher.setAuthTag(record.tag);
    return JSON.parse(Buffer.concat([decipher.update(record.encrypted), decipher.final()]).toString("utf8"));
  }

  delete(id) {
    const record = this.records.get(id);
    if (record?.timer) clearTimeout(record.timer);
    return this.records.delete(id);
  }

  prune() {
    const now = this.now();
    for (const [id, record] of this.records) if (record.expiresAt <= now) this.delete(id);
  }
}