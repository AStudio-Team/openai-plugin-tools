import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { Readable } from "node:stream";
import ipaddr from "ipaddr.js";
import { LIMITS, USER_AGENT } from "./constants.mjs";

export class AuditNetworkError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

export function redactUrl(value) {
  try {
    const parsed = new URL(value);
    for (const key of parsed.searchParams.keys()) parsed.searchParams.set(key, "[redacted]");
    return parsed.toString();
  } catch {
    return "[invalid URL]";
  }
}

export function normalizePublicHttpsUrl(value) {
  if (typeof value !== "string" || value.length < 9 || value.length > 2048) throw new AuditNetworkError("INVALID_URL", "Provide one HTTPS URL of at most 2,048 characters.");
  if (/[\\\u0000-\u001f\u007f]/u.test(value)) throw new AuditNetworkError("INVALID_URL", "The URL contains an unsafe character.");
  let parsed;
  try { parsed = new URL(value); } catch { throw new AuditNetworkError("INVALID_URL", "The URL is malformed."); }
  if (parsed.protocol !== "https:") throw new AuditNetworkError("HTTPS_REQUIRED", "Only public HTTPS URLs are supported.");
  if (parsed.username || parsed.password) throw new AuditNetworkError("USERINFO_NOT_ALLOWED", "URLs containing user information are not supported.");
  if (parsed.port && parsed.port !== "443") throw new AuditNetworkError("PORT_NOT_ALLOWED", "Only the default HTTPS port 443 is supported.");
  if (parsed.hash) throw new AuditNetworkError("INVALID_URL", "URL fragments are not supported.");
  const authority = value.slice(value.indexOf("//") + 2).split(/[/?#]/, 1)[0];
  if (/%(?:2f|5c|3a|40)/i.test(authority) || authority.includes("%")) throw new AuditNetworkError("INVALID_URL", "Encoded host separators are not supported.");
  const hostname = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (ipaddr.isValid(hostname)) throw new AuditNetworkError("PRIVATE_DESTINATION", "Literal IP targets are not supported.");
  if (!hostname || hostname.endsWith(".") || hostname.includes("..") || !/^[a-z0-9.-]+$/u.test(hostname)) throw new AuditNetworkError("INVALID_URL", "The hostname is ambiguous or malformed.");
  parsed.hostname = hostname;
  parsed.port = "";
  return parsed;
}

export function isGloballyRoutable(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === "unicast";
  } catch { return false; }
}

export async function resolvePublicTarget(urlValue, resolver = dnsLookup) {
  const url = urlValue instanceof URL ? urlValue : normalizePublicHttpsUrl(urlValue);
  let records;
  try { records = await resolver(url.hostname, { all: true, verbatim: true }); }
  catch { throw new AuditNetworkError("DNS_FAILURE", "The public hostname could not be resolved.", true); }
  if (!Array.isArray(records) || !records.length) throw new AuditNetworkError("DNS_FAILURE", "The public hostname returned no addresses.", true);
  if (records.some(record => !isGloballyRoutable(record.address))) throw new AuditNetworkError("PRIVATE_DESTINATION", "The destination resolves to a private, reserved, or non-routable address.");
  return { url, addresses: records.map(record => ({ address: record.address, family: Number(record.family) })) };
}

function decoderFor(value) {
  const encoding = String(value || "identity").toLowerCase().trim();
  if (!encoding || encoding === "identity") return null;
  if (encoding === "gzip" || encoding === "x-gzip") return createGunzip();
  if (encoding === "deflate") return createInflate();
  if (encoding === "br") return createBrotliDecompress();
  throw new AuditNetworkError("UNSUPPORTED_ENCODING", "The response used an unsupported content encoding.");
}

async function readBounded(response, maxBytes, signal) {
  const decoder = decoderFor(response.headers["content-encoding"]);
  const stream = decoder ? Readable.from(response).pipe(decoder) : Readable.from(response);
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw signal.reason;
      total += chunk.length;
      if (total > maxBytes) throw new AuditNetworkError("BODY_TOO_LARGE", "The response exceeded the audit size limit.");
      chunks.push(chunk);
    }
  } catch (error) {
    response.destroy();
    if (error instanceof AuditNetworkError) throw error;
    throw new AuditNetworkError("RESPONSE_READ_FAILED", "The response could not be read safely.", true);
  }
  return Buffer.concat(chunks);
}

function onePinnedRequest(target, { method = "GET", maxBytes, signal }) {
  const selected = target.addresses[0];
  return new Promise((resolve, reject) => {
    let connected = false;
    const request = https.request({
      protocol: "https:", hostname: target.url.hostname, servername: target.url.hostname,
      port: 443, method, path: `${target.url.pathname}${target.url.search}`,
      headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,application/xml,text/xml,application/xhtml+xml;q=0.9,*/*;q=0.1", "accept-encoding": "gzip, deflate, br" },
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
      timeout: LIMITS.connectTimeoutMs,
      signal,
    }, response => resolve({ response, maxBytes }));
    request.on("socket", socket => socket.once("secureConnect", () => {
      connected = true;
      const peer = socket.remoteAddress?.replace(/^::ffff:/, "");
      const expected = selected.address.replace(/^::ffff:/, "");
      if (peer !== expected) request.destroy(new AuditNetworkError("PIN_MISMATCH", "The connected address did not match the validated address."));
    }));
    request.setTimeout(LIMITS.requestTimeoutMs, () => request.destroy(new AuditNetworkError(connected ? "REQUEST_TIMEOUT" : "CONNECT_TIMEOUT", "The public request timed out.", true)));
    request.on("error", error => reject(error instanceof AuditNetworkError ? error : new AuditNetworkError("TARGET_UNREACHABLE", "The public target could not be reached over verified HTTPS.", true)));
    request.end();
  });
}

function allowedContentType(value) {
  const type = String(value || "").toLowerCase().split(";", 1)[0].trim();
  if (!type) return true;
  return type.startsWith("text/") || ["application/xml", "application/xhtml+xml", "application/json", "application/ld+json"].includes(type) || type.endsWith("+xml");
}

export async function safeRequest(urlValue, options = {}) {
  const resolver = options.resolver || dnsLookup;
  const requestImpl = options.requestImpl || onePinnedRequest;
  const maxRedirects = options.maxRedirects ?? LIMITS.redirects;
  const maximumRequests = options.maximumRequests ?? maxRedirects + 1;
  const deadline = options.deadline ?? Date.now() + 30_000;
  let current = normalizePublicHttpsUrl(urlValue);
  const redirects = [];
  let requestsMade = 0;
  for (;;) {
    if (Date.now() >= deadline) throw new AuditNetworkError("AUDIT_TIMEOUT", "The audit time limit was reached.", true);
    if (requestsMade >= maximumRequests) throw new AuditNetworkError("REQUEST_BUDGET_EXCEEDED", "The request budget was reached.");
    const target = await resolvePublicTarget(current, resolver);
    requestsMade += 1;
    const controller = new AbortController();
    const remaining = Math.max(1, Math.min(LIMITS.requestTimeoutMs, deadline - Date.now()));
    const timer = setTimeout(() => controller.abort(new AuditNetworkError("REQUEST_TIMEOUT", "The public request timed out.", true)), remaining);
    let response;
    try { ({ response } = await requestImpl(target, { method: options.method || "GET", maxBytes: options.maxBytes || LIMITS.controlBytes, signal: controller.signal })); }
    finally { clearTimeout(timer); }
    const status = Number(response.statusCode || 0);
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.location;
      response.resume?.();
      if (!location) throw new AuditNetworkError("UNSAFE_REDIRECT", "The redirect did not include a destination.");
      if (redirects.length >= maxRedirects) throw new AuditNetworkError("TOO_MANY_REDIRECTS", "The target redirected too many times.");
      let next;
      try { next = new URL(location, current); } catch { throw new AuditNetworkError("UNSAFE_REDIRECT", "The redirect destination is malformed."); }
      if (next.protocol !== "https:") throw new AuditNetworkError("UNSAFE_REDIRECT", "HTTPS downgrade redirects are not supported.");
      const normalizedNext = normalizePublicHttpsUrl(next.toString());
      redirects.push({ from: redactUrl(current.toString()), to: redactUrl(normalizedNext.toString()), status });
      current = normalizedNext;
      continue;
    }
    const contentType = String(response.headers["content-type"] || "") || null;
    if (!allowedContentType(contentType)) { response.destroy?.(); throw new AuditNetworkError("UNSUPPORTED_CONTENT_TYPE", "The response is binary, archived, multipart, or executable content."); }
    const body = options.method === "HEAD" ? Buffer.alloc(0) : await readBounded(response, options.maxBytes || LIMITS.controlBytes, controller.signal);
    return {
      url: current.toString(), displayUrl: redactUrl(current.toString()), status, contentType,
      headers: { "x-robots-tag": String(response.headers["x-robots-tag"] || ""), location: String(response.headers.location || "") },
      body, redirects, requestsMade, downloadedBytes: body.length, retrievedAt: new Date().toISOString(),
    };
  }
}
