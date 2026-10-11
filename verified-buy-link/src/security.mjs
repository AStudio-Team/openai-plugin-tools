import dns from "node:dns/promises";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

export const FETCH_LIMITS = Object.freeze({
  redirects: 3,
  connectMs: 5_000,
  totalMs: 12_000,
  responseBytes: 1_000_000,
  headerBytes: 32_768,
});

const TRACKING_KEYS = /^(utm_.+|fbclid|gclid|msclkid|mc_cid|mc_eid|ref|ref_|affiliate|aff|affid|tag|campaign)$/i;
const BLOCKED_RANGES = new Set([
  "unspecified", "broadcast", "multicast", "linkLocal", "loopback", "private",
  "reserved", "carrierGradeNat", "uniqueLocal", "ipv4Mapped", "rfc6145", "rfc6052",
  "6to4", "teredo",
]);

export function normalizeProductUrl(input, { production = process.env.NODE_ENV === "production" } = {}) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    throw new Error("URL is malformed.");
  }
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not accepted.");
  if (url.hash) url.hash = "";
  if (!['https:', ...(production ? [] : ['http:'])].includes(url.protocol)) throw new Error("Only HTTPS product URLs are accepted.");
  const ascii = domainToASCII(url.hostname.toLowerCase());
  if (!ascii || ascii.endsWith(".")) throw new Error("URL hostname is invalid.");
  url.hostname = ascii;
  const allowedPort = production ? ["", "443"] : ["", "80", "443"];
  if (!allowedPort.includes(url.port)) throw new Error("URL port is not allowed.");
  for (const key of [...url.searchParams.keys()]) if (TRACKING_KEYS.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  return url.toString();
}

export function isPublicAddress(address) {
  if (!isIP(address)) return false;
  const parsed = ipaddr.parse(address);
  return !BLOCKED_RANGES.has(parsed.range());
}

export async function resolvePublicHost(hostname, resolver = dns.lookup) {
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error("Destination address is not public.");
    return [hostname];
  }
  const records = await resolver(hostname, { all: true, verbatim: true });
  const addresses = [...new Set(records.map(record => record.address))];
  if (!addresses.length || addresses.some(address => !isPublicAddress(address))) throw new Error("Destination resolved to a blocked or unknown address.");
  return addresses;
}

function headerSize(headers) {
  let size = 0;
  for (const [name, value] of headers) size += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
  return size;
}

async function readLimitedText(response, limit) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Response exceeds the decompressed size limit.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function safeFetchText(input, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const resolver = options.resolver || dns.lookup;
  const limits = { ...FETCH_LIMITS, ...(options.limits || {}) };
  const production = options.production ?? process.env.NODE_ENV === "production";
  let current = normalizeProductUrl(input, { production });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.totalMs);
  try {
    for (let hop = 0; hop <= limits.redirects; hop += 1) {
      const parsed = new URL(current);
      const approvedAddresses = await resolvePublicHost(parsed.hostname, resolver);
      const pinnedAddress = approvedAddresses[0];
      const dispatcher = options.dispatcherFactory
        ? options.dispatcherFactory({ hostname: parsed.hostname, approvedAddresses })
        : new Agent({ connect: {
          timeout: limits.connectMs,
          lookup: (_hostname, lookupOptions, callback) => {
            const answer = { address: pinnedAddress, family: isIP(pinnedAddress) };
            if (lookupOptions?.all) callback(null, [answer]);
            else callback(null, answer.address, answer.family);
          },
        } });
      try {
        const response = await fetchImpl(current, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
            "accept-encoding": "gzip, br",
            "user-agent": "VerifiedBuyLink/1.0 (+https://www.astudio.agency/tools/verified-buy-link)",
          },
          dispatcher,
        });
        if (headerSize(response.headers) > limits.headerBytes) throw new Error("Response headers exceed the limit.");
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (hop === limits.redirects) throw new Error("Redirect limit exceeded.");
          const location = response.headers.get("location");
          if (!location) throw new Error("Redirect is missing a location.");
          const next = normalizeProductUrl(new URL(location, current).toString(), { production });
          if (options.allowRedirect && !options.allowRedirect(current, next)) throw new Error("Redirect destination is not approved.");
          current = next;
          continue;
        }
        if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
        const type = (response.headers.get("content-type") || "").toLowerCase();
        if (!type.includes("text/html") && !type.includes("application/xhtml+xml") && !type.includes("text/plain")) throw new Error("Source did not return a supported text page.");
        return {
          url: current,
          status: response.status,
          contentType: type,
          text: await readLimitedText(response, limits.responseBytes),
          approvedAddresses,
        };
      } finally {
        if (!options.dispatcherFactory) await dispatcher.close();
      }
    }
    throw new Error("Redirect handling failed.");
  } finally {
    clearTimeout(timer);
  }
}

function wildcardPattern(value) {
  return new RegExp(`^${value.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}`);
}

export function robotsAllows(robotsText, productUrl, userAgent = "VerifiedBuyLink") {
  const path = new URL(productUrl).pathname + new URL(productUrl).search;
  const groups = [];
  let agents = [];
  let rules = [];
  const flush = () => { if (agents.length) groups.push({ agents, rules }); agents = []; rules = []; };
  for (const raw of String(robotsText || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line.includes(":")) continue;
    const [name, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (name.trim().toLowerCase() === "user-agent") {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if (["allow", "disallow"].includes(name.trim().toLowerCase()) && agents.length) {
      rules.push({ type: name.trim().toLowerCase(), value });
    }
  }
  flush();
  const target = userAgent.toLowerCase();
  let matching = groups.filter(group => group.agents.some(agent => agent === target));
  if (!matching.length) matching = groups.filter(group => group.agents.includes("*"));
  const applicable = matching.flatMap(group => group.rules)
    .filter(rule => rule.value && wildcardPattern(rule.value).test(path))
    .sort((a, b) => b.value.length - a.value.length);
  return applicable.length === 0 || applicable[0].type === "allow";
}

export function robotsUrlFor(productUrl) {
  const url = new URL(productUrl);
  return `${url.protocol}//${url.host}/robots.txt`;
}

export function validateSourceRight(entry, hostname, now = new Date()) {
  if (!entry || entry.domain !== hostname || entry.automated_retrieval_allowed !== true) return false;
  for (const field of ["access_basis", "terms_url", "reviewed_at", "caching_and_retention", "attribution_requirement", "geographic_restrictions", "rate_limit", "owner"]) if (!entry[field]) return false;
  if (!Array.isArray(entry.permitted_fields) || !entry.permitted_fields.length) return false;
  const reviewed = Date.parse(entry.reviewed_at);
  return Number.isFinite(reviewed) && reviewed <= now.getTime() && now.getTime() - reviewed <= 30 * 24 * 60 * 60 * 1000;
}