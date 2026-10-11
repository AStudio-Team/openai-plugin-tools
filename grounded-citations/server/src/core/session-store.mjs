import { randomBytes } from "node:crypto";

const DEFAULTS = { idleTtlMs: 2 * 60 * 60 * 1000, hardTtlMs: 24 * 60 * 60 * 1000, maxSessions: 100, maxDeleted: 1000 };

export class SessionStore {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.sessions = new Map();
    this.deleted = new Map();
    this.cleanup = setInterval(() => this.prune(), this.options.cleanupIntervalMs || 60_000);
    this.cleanup.unref();
  }
  prune(now = Date.now()) {
    for (const [id, session] of this.sessions) {
      if (session.expiresAtMs <= now || session.hardExpiresAtMs <= now) this.sessions.delete(id);
    }
    for (const [id, at] of this.deleted) if (now - at > this.options.hardTtlMs) this.deleted.delete(id);
    while (this.deleted.size > this.options.maxDeleted) this.deleted.delete(this.deleted.keys().next().value);
  }
  create(brief, candidateSources, now = Date.now()) {
    this.prune(now);
    if (this.sessions.size >= this.options.maxSessions) throw serviceError("capacity_exceeded", "Session capacity is temporarily exhausted.");
    const id = randomBytes(32).toString("base64url");
    const session = {
      id, createdAtMs: now, lastActivityAtMs: now,
      expiresAtMs: now + this.options.idleTtlMs,
      hardExpiresAtMs: now + this.options.hardTtlMs,
      status: "awaiting_confirmation", scopeRevision: 1, ledgerRevision: 0,
      brief, candidateSources, ledgers: new Map(),
    };
    this.sessions.set(id, session);
    return session;
  }
  get(id, now = Date.now()) {
    this.prune(now);
    const session = this.sessions.get(id);
    if (!session) throw serviceError(this.deleted.has(id) ? "session_deleted" : "session_not_found", "Citation session is unavailable or expired.");
    session.lastActivityAtMs = now;
    session.expiresAtMs = Math.min(now + this.options.idleTtlMs, session.hardExpiresAtMs);
    return session;
  }
  requireLedger(id, revision, now = Date.now()) {
    const session = this.get(id, now);
    if (revision !== session.ledgerRevision || !session.ledgers.has(revision)) {
      throw serviceError("revision_conflict", `Ledger revision ${revision} is stale. Current revision is ${session.ledgerRevision}.`, { current_revision: session.ledgerRevision });
    }
    return { session, ledger: session.ledgers.get(revision) };
  }
  delete(id, now = Date.now()) {
    this.prune(now);
    const existed = this.sessions.delete(id);
    this.deleted.set(id, now);
    return existed ? "deleted" : "already_deleted";
  }
  stop() { clearInterval(this.cleanup); }
}

export function serviceError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}
