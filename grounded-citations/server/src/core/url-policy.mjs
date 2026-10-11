import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import ipaddr from "ipaddr.js";

export const URL_LIMITS = { maxBytes: 25 * 1024 * 1024, timeoutMs: 30_000, maxRedirects: 5 };

export function normalizePublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw policyError("invalid_url", "Source URL is invalid."); }
  if (url.protocol !== "https:") throw policyError("https_required", "Only safe public HTTPS sources are accepted.");
  if (url.username || url.password) throw policyError("credentials_forbidden", "URLs containing credentials are not accepted.");
  if (url.port && url.port !== "443") throw policyError("port_forbidden", "Only the standard HTTPS port is accepted.");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function isPublicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === "unicast";
  } catch { return false; }
}

export async function validateAndPin(raw, resolver = dns.lookup) {
  const normalized = normalizePublicUrl(raw);
  const url = new URL(normalized);
  if (net.isIP(url.hostname)) {
    if (!isPublicAddress(url.hostname)) throw policyError("private_destination", "Private, reserved, loopback and link-local destinations are blocked.");
    return { url, address: url.hostname, family: net.isIP(url.hostname) };
  }
  let records;
  try { records = await resolver(url.hostname, { all: true, verbatim: true }); } catch { throw policyError("dns_failed", "The source hostname could not be resolved."); }
  if (!records.length || records.some(record => !isPublicAddress(record.address))) throw policyError("private_destination", "Private, reserved, loopback and link-local destinations are blocked.");
  return { url, address: records[0].address, family: records[0].family };
}

export async function retrieveUrl(raw, options = {}) {
  const limits = { ...URL_LIMITS, ...options };
  const resolver = options.resolver || dns.lookup;
  const requester = options.requester || https.request;
  let current = raw;
  const started = Date.now();
  for (let redirect = 0; redirect <= limits.maxRedirects; redirect += 1) {
    if (Date.now() - started >= limits.timeoutMs) throw policyError("retrieval_timeout", "Source retrieval timed out.");
    const pinned = await validateAndPin(current, resolver);
    const response = await requestPinned(pinned, { ...limits, requester, remainingMs: limits.timeoutMs - (Date.now() - started) });
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      if (redirect === limits.maxRedirects) throw policyError("redirect_limit", "Source exceeded the redirect limit.");
      if (!response.headers.location) throw policyError("bad_redirect", "Source returned an invalid redirect.");
      current = new URL(response.headers.location, pinned.url).toString();
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) throw policyError("upstream_status", `Source returned HTTP ${response.statusCode}.`);
    return { body: response.body, contentType: String(response.headers["content-type"] || "").split(";")[0].toLowerCase(), finalUrl: pinned.url.toString(), redirects: redirect };
  }
  throw policyError("redirect_limit", "Source exceeded the redirect limit.");
}

function requestPinned(pinned, options) {
  return new Promise((resolve, reject) => {
    const req = options.requester({
      protocol: "https:", hostname: pinned.url.hostname, port: 443,
      path: `${pinned.url.pathname}${pinned.url.search}`, method: "GET",
      servername: pinned.url.hostname, headers: { host: pinned.url.host, accept: "text/html,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document", "accept-encoding": "identity", "user-agent": "Grounded-Citations/1.0" },
      lookup: (_hostname, _opts, callback) => callback(null, pinned.address, pinned.family),
      timeout: Math.max(1, options.remainingMs),
    }, res => {
      const declared = Number(res.headers["content-length"] || 0);
      const encoding = String(res.headers["content-encoding"] || "identity").toLowerCase();
      if (encoding !== "identity") { res.resume(); reject(policyError("compressed_response", "Compressed source responses are not accepted.")); return; }
      if (declared > options.maxBytes) { res.resume(); reject(policyError("source_too_large", "Source exceeds the byte limit.")); return; }
      if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) { res.resume(); resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.alloc(0) }); return; }
      const chunks = []; let total = 0;
      res.on("data", chunk => { total += chunk.length; if (total > options.maxBytes) req.destroy(policyError("source_too_large", "Source exceeds the streamed byte limit.")); else chunks.push(chunk); });
      res.on("end", () => resolve({ statusCode: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(policyError("retrieval_timeout", "Source retrieval timed out.")));
    req.on("error", error => reject(error.code ? error : policyError("retrieval_failed", "Source retrieval failed.")));
    req.end();
  });
}

export function policyError(code, message) { return Object.assign(new Error(message), { code }); }
