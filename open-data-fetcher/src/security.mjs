import dns from "node:dns/promises";
import net from "node:net";
import https from "node:https";

const IPV4_BLOCKS = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function ipv4Number(ip) {
  return ip.split(".").reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0) >>> 0;
}

export function isBlockedAddress(address) {
  const normalized = String(address).toLowerCase().split("%")[0];
  if (net.isIPv4(normalized)) {
    const value = ipv4Number(normalized);
    return IPV4_BLOCKS.some(([network, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (value & mask) === (ipv4Number(network) & mask);
    });
  }
  if (!net.isIPv6(normalized)) return true;
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff") || normalized.startsWith("2001:db8:") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

export async function validatePublicUrl(rawUrl, allowedOrigins, lookup = dns.lookup) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error("INVALID_URL"); }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) throw new Error("URL_POLICY_BLOCKED");
  if (!allowedOrigins.has(url.origin)) throw new Error("ORIGIN_NOT_ALLOWLISTED");
  if (net.isIP(url.hostname) && isBlockedAddress(url.hostname)) throw new Error("PRIVATE_ADDRESS_BLOCKED");
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => isBlockedAddress(record.address))) throw new Error("PRIVATE_ADDRESS_BLOCKED");
  return { url, addresses: records.map(record => record.address) };
}

export async function safeFetch(rawUrl, options = {}) {
  const {
    allowedOrigins, lookup = dns.lookup, fetchImpl = fetch, maxBytes = 5 * 1024 * 1024,
    timeoutMs = 30_000, redirects = 3, headers = {}, method = "GET",
  } = options;
  let current = rawUrl;
  for (let hop = 0; hop <= redirects; hop += 1) {
    const validated = await validatePublicUrl(current, allowedOrigins, lookup);
    if (fetchImpl === fetch) {
      const pinned = await new Promise((resolve, reject) => {
        const address = validated.addresses[0]; const family = net.isIPv6(address) ? 6 : 4;
        const request = https.request(validated.url, {
          method, headers: { accept: headers.accept || "application/json,text/csv,text/plain;q=0.8", "user-agent": "ASTUDIO-Open-Data-Fetcher/1.0" },
          maxHeaderSize: 16 * 1024, servername: validated.url.hostname,
          lookup: (_hostname, lookupOptions, callback) => lookupOptions?.all ? callback(null, [{ address, family }]) : callback(null, address, family),
        }, response => {
          const location = response.headers.location;
          if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) { response.resume(); resolve({ redirect: location }); return; }
          if ((response.statusCode || 500) >= 400) { response.resume(); reject(Object.assign(new Error("UPSTREAM_ERROR"), { status: response.statusCode, retryAfter: response.headers["retry-after"] })); return; }
          const declared = Number(response.headers["content-length"] || 0);
          if (declared > maxBytes) { response.destroy(); reject(new Error("REMOTE_SIZE_LIMIT")); return; }
          const chunks = []; let total = 0;
          response.on("data", chunk => { total += chunk.length; if (total > maxBytes) response.destroy(new Error("REMOTE_SIZE_LIMIT")); else chunks.push(chunk); });
          response.on("end", () => resolve({ buffer: Buffer.concat(chunks), headers: response.headers }));
          response.on("error", reject);
        });
        request.setTimeout(timeoutMs, () => request.destroy(new Error("UPSTREAM_TIMEOUT")));
        request.on("error", reject); request.end();
      });
      if (pinned.redirect !== undefined) {
        if (hop === redirects) throw new Error("TOO_MANY_REDIRECTS");
        if (!pinned.redirect) throw new Error("REDIRECT_WITHOUT_LOCATION");
        current = new URL(pinned.redirect, current).toString();
        continue;
      }
      return { response: { headers: pinned.headers }, buffer: pinned.buffer, finalUrl: current };
    }
    const response = await fetchImpl(current, {
      method, redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: headers.accept || "application/json,text/csv,text/plain;q=0.8", "user-agent": "ASTUDIO-Open-Data-Fetcher/1.0" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (hop === redirects) throw new Error("TOO_MANY_REDIRECTS");
      const location = response.headers.get("location");
      if (!location) throw new Error("REDIRECT_WITHOUT_LOCATION");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw Object.assign(new Error("UPSTREAM_ERROR"), { status: response.status, retryAfter: response.headers.get("retry-after") });
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxBytes) throw new Error("REMOTE_SIZE_LIMIT");
    const reader = response.body?.getReader();
    if (!reader) return { response, buffer: Buffer.alloc(0), finalUrl: current };
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error("REMOTE_SIZE_LIMIT"); }
      chunks.push(Buffer.from(value));
    }
    return { response, buffer: Buffer.concat(chunks), finalUrl: current };
  }
  throw new Error("FETCH_FAILED");
}

export function assertSafeArchive(buffer, limits = {}) {
  const maxEntries = limits.maxEntries || 1000;
  const maxExpanded = limits.maxExpanded || 500 * 1024 * 1024;
  const maxRatio = limits.maxRatio || 100;
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) return { archive: false };
  let offset = 0;
  let entries = 0;
  let expanded = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressed = buffer.readUInt32LE(offset + 18);
    const uncompressed = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameEnd = offset + 30 + nameLength;
    if (nameEnd + extraLength > buffer.length) throw new Error("ARCHIVE_TRUNCATED");
    const name = buffer.subarray(offset + 30, nameEnd).toString("utf8").normalize("NFC").replaceAll("\\", "/");
    entries += 1;
    expanded += uncompressed;
    if (flags & 1) throw new Error("ARCHIVE_ENCRYPTED");
    if (![0, 8].includes(method)) throw new Error("ARCHIVE_METHOD_BLOCKED");
    if (!name || name.startsWith("/") || name.split("/").includes("..") || /^[a-z]:/i.test(name) || name.includes("\0")) throw new Error("ARCHIVE_PATH_BLOCKED");
    if (entries > maxEntries || expanded > maxExpanded || (compressed === 0 ? uncompressed > 0 : uncompressed / compressed > maxRatio)) throw new Error("ARCHIVE_BOMB_BLOCKED");
    offset = nameEnd + extraLength + compressed;
  }
  return { archive: true, entries, expandedBytes: expanded };
}
