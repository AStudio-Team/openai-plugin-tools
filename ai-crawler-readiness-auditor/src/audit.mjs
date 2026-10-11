import { CHECK_IDS, PAGE_CHECKS, LIMITS, CRAWLER_TOKENS, DISCLAIMER } from "./constants.mjs";
import { safeRequest, redactUrl, AuditNetworkError } from "./network.mjs";
import { extractAttr, extractTag, plain, visibleText } from "./text.mjs";
import { SaxesParser } from "saxes";

const TITLES = {
  target_fetch: ["Target response", "transport"], robots_access: ["Crawler access rules", "access"],
  page_directives: ["Page indexing directives", "access"], page_metadata: ["Page metadata", "page"],
  structured_data: ["Structured data", "structured_data"], sitemap: ["Sitemap discovery", "discovery"],
  llms_txt: ["llms.txt", "discovery"], llms_full_txt: ["llms-full.txt", "discovery"],
  challenge_signals: ["Access challenge signals", "transport"],
};

function evidence(response, observed, expected, excerpt = null) {
  return { sourceUrl: response?.displayUrl || "", retrievedAt: response?.retrievedAt || new Date().toISOString(), httpStatus: response?.status ?? null, contentType: response?.contentType ?? null, observed: plain(observed, 400), expected: plain(expected, 400), excerpt: excerpt ? plain(excerpt, 240) : null };
}
function check(id, outcome, severity, explanation, records = [], limitations = []) {
  const [title, category] = TITLES[id];
  return { id, title, category, outcome, severity, explanation, evidence: records, limitations };
}
function remediation(id, findingIds, priority, title, action, verification) { return { id, findingIds, priority, title, action, verification }; }
function htmlResponse(response) { return /(?:text\/html|application\/xhtml\+xml)/i.test(response.contentType || "") || /^\s*<!doctype html|^\s*<html\b/i.test(response.body.toString("utf8", 0, 300)); }
function successful(response) { return response.status >= 200 && response.status < 300; }
function directiveTokens(value) { return new Set(String(value || "").toLowerCase().split(/[,;]/).flatMap(part => part.trim().split(/\s+/)).filter(Boolean)); }

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let agents = [];
  let rules = [];
  let seenRule = false;
  const flush = () => { if (agents.length) groups.push({ agents: [...agents], rules: [...rules] }); agents = []; rules = []; seenRule = false; };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "sitemap" && value) { sitemaps.push(value); continue; }
    if (key === "user-agent") {
      if (seenRule) flush();
      if (value) agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && agents.length) {
      rules.push({ type: key, pattern: value }); seenRule = true;
    }
  }
  flush();
  return { groups, sitemaps };
}
function robotPatternMatch(pattern, path) {
  if (!pattern) return null;
  const anchored = pattern.endsWith("$");
  const source = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + (anchored ? "$" : "");
  try { return new RegExp(`^${escaped}`).test(path) ? pattern.replace(/[\*$]/g, "").length : null; } catch { return null; }
}
export function effectiveRobotsRule(parsed, token, path) {
  const lower = token.toLowerCase();
  const candidates = parsed.groups.filter(group => group.agents.some(agent => agent === "*" || lower.includes(agent)));
  const exact = candidates.filter(group => group.agents.some(agent => agent !== "*" && lower.includes(agent)));
  const groups = exact.length ? exact : candidates.filter(group => group.agents.includes("*"));
  let winner = null;
  for (const group of groups) for (const rule of group.rules) {
    const length = robotPatternMatch(rule.pattern, path);
    if (length === null) continue;
    if (!winner || length > winner.length || (length === winner.length && rule.type === "allow")) winner = { ...rule, length };
  }
  return winner || { type: "allow", pattern: "(no matching disallow)", length: 0 };
}

function robotsCheck(response, targetPath) {
  if (!response) return check("robots_access", "error", "medium", "robots.txt could not be tested.", [], ["The control file request failed."]);
  if (response.status === 404) return check("robots_access", "pass", "info", "robots.txt is absent, so no robots.txt path restriction was observed.", [evidence(response, "HTTP 404", "A readable robots.txt or an absent file")]);
  if (!successful(response)) return check("robots_access", "error", "medium", `robots.txt returned HTTP ${response.status}.`, [evidence(response, `HTTP ${response.status}`, "HTTP 200 or 404")]);
  const parsed = parseRobots(response.body.toString("utf8"));
  const rules = CRAWLER_TOKENS.map(token => ({ token, rule: effectiveRobotsRule(parsed, token, targetPath) }));
  const blocked = rules.filter(item => item.rule.type === "disallow");
  const observed = rules.map(item => `${item.token}: ${item.rule.type} ${item.rule.pattern}`).join("; ");
  if (blocked.length) return check("robots_access", "block", "high", `robots.txt disallows the requested path for ${blocked.length} configured crawler token${blocked.length === 1 ? "" : "s"}.`, [evidence(response, observed, "No effective disallow for the requested path", response.body.toString("utf8"))]);
  return check("robots_access", "pass", "info", "No effective robots.txt disallow was found for the configured crawler tokens.", [evidence(response, observed, "No effective disallow for the requested path")]);
}

function targetCheck(response) {
  if (!response) return check("target_fetch", "error", "critical", "The target page could not be retrieved.", [], ["No page response was available."]);
  if (!successful(response)) return check("target_fetch", "block", "critical", `The target returned HTTP ${response.status}.`, [evidence(response, `HTTP ${response.status}`, "HTTP 200 HTML response")]);
  if (!htmlResponse(response)) return check("target_fetch", "warn", "medium", "The target did not identify as HTML.", [evidence(response, response.contentType || "No content type", "HTML content type")]);
  return check("target_fetch", "pass", "info", "The target returned public HTML over verified HTTPS.", [evidence(response, `HTTP ${response.status}, ${response.contentType || "content type absent"}`, "HTTP 200 HTML response")]);
}
function challengeCheck(response) {
  if (!response) return check("challenge_signals", "error", "high", "Challenge signals could not be inspected.", [], ["No page response was available."]);
  const text = plain(response.body.toString("utf8"), 5000).toLowerCase();
  const signals = ["verify you are human", "checking your browser", "access denied", "captcha", "cloudflare ray id", "enable javascript and cookies"].filter(value => text.includes(value));
  if ([403, 429, 503].includes(response.status) || signals.length) return check("challenge_signals", "block", "high", "The response appears to be an access challenge or interstitial rather than the requested content.", [evidence(response, signals.join(", ") || `HTTP ${response.status}`, "Requested page content without a challenge", text)]);
  return check("challenge_signals", "pass", "info", "No common access-challenge signal was observed in the server response.", [evidence(response, "No common challenge signature", "No access challenge")]);
}
function directivesCheck(response) {
  if (!response || !htmlResponse(response)) return check("page_directives", "not_tested", "info", "Page directives were not tested because HTML was unavailable.", [], ["Requires a server-returned HTML page."]);
  const html = response.body.toString("utf8");
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].filter(match => /^(robots|googlebot|bingbot)$/i.test(extractAttr(match[0], "name")));
  const values = metas.map(match => `${extractAttr(match[0], "name")}: ${extractAttr(match[0], "content")}`);
  const combined = new Set([...directiveTokens(response.headers["x-robots-tag"]), ...values.flatMap(value => [...directiveTokens(value)])]);
  const blocking = ["noindex", "none", "nosnippet"].filter(value => combined.has(value));
  const records = [evidence(response, `X-Robots-Tag: ${response.headers["x-robots-tag"] || "absent"}; meta: ${values.join("; ") || "absent"}`, "No blocking page-level directive")];
  if (blocking.length) return check("page_directives", "block", "high", `Blocking page directive${blocking.length === 1 ? "" : "s"} observed: ${blocking.join(", ")}.`, records);
  return check("page_directives", "pass", "info", "No blocking page-level robots directive was observed.", records);
}
function metadataCheck(response) {
  if (!response || !htmlResponse(response)) return check("page_metadata", "not_tested", "info", "Page metadata was not tested because HTML was unavailable.", [], ["Requires a server-returned HTML page."]);
  const html = response.body.toString("utf8");
  const title = extractTag(html, "title");
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)];
  const description = metas.map(match => match[0]).find(tag => /^description$/i.test(extractAttr(tag, "name")));
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]);
  const canonicalTag = links.find(tag => extractAttr(tag, "rel").toLowerCase().split(/\s+/).includes("canonical"));
  const canonical = canonicalTag ? extractAttr(canonicalTag, "href") : "";
  const text = visibleText(html);
  const problems = [];
  if (!title) problems.push("title is missing");
  if (!description || !extractAttr(description, "content")) problems.push("description is missing");
  if (!canonical) problems.push("canonical URL is missing");
  else { try { if (new URL(canonical, response.url).toString() !== response.url) problems.push("canonical URL differs from the fetched URL"); } catch { problems.push("canonical URL is malformed"); } }
  if (text.length < 200) problems.push("server-delivered text is low");
  const record = evidence(response, `title=${title || "absent"}; description=${description ? extractAttr(description, "content") || "empty" : "absent"}; canonical=${canonical || "absent"}; text characters=${text.length}`, "Title, description, matching canonical URL, and meaningful server-delivered text");
  return problems.length ? check("page_metadata", "warn", "medium", problems.join("; ") + ".", [record], text.length < 200 ? ["Low server-delivered text does not prove that a crawler cannot render the page."] : []) : check("page_metadata", "pass", "info", "Title, description, canonical URL, and server-delivered text were present.", [record]);
}
function structuredDataCheck(response) {
  if (!response || !htmlResponse(response)) return check("structured_data", "not_tested", "info", "Structured data was not tested because HTML was unavailable.", [], ["Requires a server-returned HTML page."]);
  const html = response.body.toString("utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => /application\/ld\+json/i.test(extractAttr(match[1], "type"))).slice(0, LIMITS.jsonLdBlocks);
  if (!scripts.length) return check("structured_data", "warn", "low", "No JSON-LD block was found in server-returned HTML.", [evidence(response, "0 JSON-LD blocks", "Parseable JSON-LD when structured data is applicable")]);
  let invalid = 0; const types = [];
  for (const match of scripts) {
    if (Buffer.byteLength(match[2]) > LIMITS.jsonLdBlockBytes) { invalid += 1; continue; }
    try {
      const value = JSON.parse(match[2]);
      const visit = item => { if (Array.isArray(item)) item.forEach(visit); else if (item && typeof item === "object") { if (item["@type"]) types.push(...(Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]).map(String)); if (item["@graph"]) visit(item["@graph"]); } };
      visit(value);
    } catch { invalid += 1; }
  }
  const record = evidence(response, `${scripts.length} block(s), ${invalid} invalid or oversized, declared types: ${[...new Set(types)].join(", ") || "none"}`, "Every inspected JSON-LD block parses as data");
  return invalid ? check("structured_data", "warn", "medium", `${invalid} JSON-LD block${invalid === 1 ? "" : "s"} could not be parsed within the limits.`, [record]) : check("structured_data", "pass", "info", "All inspected JSON-LD blocks parsed as data.", [record]);
}
function llmsCheck(id, response) {
  const name = id === "llms_txt" ? "llms.txt" : "llms-full.txt";
  if (!response) return check(id, "error", "low", `${name} could not be tested.`, [], ["The control-file request failed."]);
  if (response.status === 404) return check(id, "warn", "low", `${name} was not found. This optional emerging convention is not a ranking requirement.`, [evidence(response, "HTTP 404", "Optional plain-text or Markdown file")]);
  const body = response.body.toString("utf8");
  const text = plain(body, 10_000);
  const issues = [];
  if (!successful(response)) issues.push(`returned HTTP ${response.status}`);
  if (response.redirects.some(item => { try { return new URL(item.to).pathname === "/"; } catch { return false; } })) issues.push("redirected to the homepage");
  if (htmlResponse(response)) issues.push("served HTML instead of text or Markdown");
  if (!text) issues.push("was empty");
  if (/verify you are human|captcha|checking your browser|access denied/i.test(text)) issues.push("contained an access challenge");
  const badLinks = [...body.matchAll(/\[[^\]]*\]\(([^)]+)\)|(?:^|\s)([a-z][a-z0-9+.-]*:\/\/\S+)/gim)].map(match => match[1] || match[2]).filter(link => { try { return !["https:", "http:"].includes(new URL(link, response.url).protocol); } catch { return true; } });
  if (badLinks.length) issues.push("contained malformed or unsupported links");
  const structure = `H1=${/^#\s+.+/m.test(body) ? "present" : "absent"}; sections=${(body.match(/^##\s+/gm) || []).length}; links=${(body.match(/https?:\/\//g) || []).length}`;
  const record = evidence(response, issues.length ? `${issues.join("; ")}; ${structure}` : `valid text-like response; ${structure}`, "Optional non-empty plain-text or Markdown file without challenge content", body);
  return issues.length ? check(id, "warn", "low", `${name} ${issues.join("; ")}. This is an optional emerging convention.`, [record]) : check(id, "pass", "info", `${name} resembled a valid text or Markdown file. This is an optional emerging convention.`, [record]);
}
function sitemapCheck(response, declared) {
  if (!response) return check("sitemap", "error", "medium", "The sitemap could not be tested.", [], ["The sitemap request failed."]);
  if (!successful(response)) return check("sitemap", "warn", "medium", `The sitemap returned HTTP ${response.status}.`, [evidence(response, `HTTP ${response.status}`, "Readable sitemap XML")]);
  const xml = response.body.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return check("sitemap", "warn", "medium", "The sitemap contains a DTD or entity declaration and was not parsed.", [evidence(response, "DTD or entity declaration present", "XML without DTDs or external entities")]);
  let root = null; let locationCount = 0; let malformed = null;
  try {
    const parser = new SaxesParser({ xmlns: true, fragment: false });
    parser.on("opentag", tag => { const local = String(tag.local || tag.name).toLowerCase(); if (!root) root = local; if (local === "loc") locationCount += 1; });
    parser.on("error", error => { malformed = error.message; });
    parser.write(xml).close();
  } catch (error) { malformed = error.message; }
  if (malformed || !["urlset", "sitemapindex"].includes(root)) return check("sitemap", "warn", "medium", "The sitemap XML was malformed or used an unsupported root.", [evidence(response, malformed || `Unsupported root ${root || "absent"}`, "Well-formed sitemap XML")]);
  const total = Math.min(locationCount, LIMITS.sitemapEntries);
  const truncated = locationCount > LIMITS.sitemapEntries;
  return check("sitemap", "pass", "info", `A ${root} sitemap was parsed with ${total}${truncated ? "+" : ""} location entries within the audit limits.`, [evidence(response, `${declared ? "Declared" : "Default"} ${root}; ${total}${truncated ? "+" : ""} entries`, "Readable sitemap XML")], truncated ? ["Entry counting stopped at 5,000. Individual listed URLs were not fetched."] : ["Individual listed URLs were not fetched."]);
}

async function getControl(origin, path, context, maxBytes = LIMITS.controlBytes) {
  if (context.usage.requestsMade >= 8) throw new AuditNetworkError("REQUEST_BUDGET_EXCEEDED", "The audit request budget was reached.");
  const result = await context.request(new URL(path, origin).toString(), { maxBytes, maximumRequests: 8 - context.usage.requestsMade, deadline: context.deadline });
  context.usage.requestsMade += result.requestsMade;
  context.usage.downloadedBytes += result.downloadedBytes;
  return result;
}

export async function runAudit({ url, scope, checks }, dependencies = {}) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const context = { request: dependencies.request || safeRequest, deadline: started + 30_000, usage: { requestsMade: 0, downloadedBytes: 0 } };
  const selected = new Set(checks);
  const results = [];
  const errors = [];
  const responses = {};
  let finalUrl = url;
  let finalOrigin = new URL(url).origin;
  const needPage = [...selected].some(id => PAGE_CHECKS.has(id)) && scope === "page_and_site_controls";
  if (needPage) {
    try {
      responses.page = await getControl(finalOrigin, new URL(url).pathname + new URL(url).search, context, LIMITS.htmlBytes);
      finalUrl = responses.page.url; finalOrigin = new URL(finalUrl).origin;
      if (dependencies.expectedOrigin && finalOrigin !== dependencies.expectedOrigin) throw new AuditNetworkError("ORIGIN_CHANGED", "The destination origin changed after confirmation.");
    } catch (error) { errors.push({ checkId: "target_fetch", code: error.code || "TARGET_FETCH_FAILED", message: error.message, retryable: Boolean(error.retryable) }); }
  }
  if (errors.some(error => error.code === "ORIGIN_CHANGED")) throw new AuditNetworkError("ORIGIN_CHANGED", "The destination origin changed after confirmation.");
  let robotsParsed = { groups: [], sitemaps: [] };
  if (selected.has("robots_access") || selected.has("sitemap")) {
    try { responses.robots = await getControl(finalOrigin, "/robots.txt", context); if (successful(responses.robots)) robotsParsed = parseRobots(responses.robots.body.toString("utf8")); }
    catch (error) { errors.push({ checkId: "robots_access", code: error.code || "ROBOTS_FETCH_FAILED", message: error.message, retryable: Boolean(error.retryable) }); }
  }
  if (selected.has("sitemap")) {
    const sitemapUrl = robotsParsed.sitemaps.find(value => { try { return new URL(value).protocol === "https:"; } catch { return false; } }) || new URL("/sitemap.xml", finalOrigin).toString();
    try { responses.sitemap = await getControl(finalOrigin, sitemapUrl, context, LIMITS.sitemapBytes); responses.sitemapDeclared = robotsParsed.sitemaps.length > 0; }
    catch (error) { errors.push({ checkId: "sitemap", code: error.code || "SITEMAP_FETCH_FAILED", message: error.message, retryable: Boolean(error.retryable) }); }
  }
  for (const [id, path] of [["llms_txt", "/llms.txt"], ["llms_full_txt", "/llms-full.txt"]]) if (selected.has(id)) {
    try { responses[id] = await getControl(finalOrigin, path, context); }
    catch (error) { errors.push({ checkId: id, code: error.code || "CONTROL_FETCH_FAILED", message: error.message, retryable: Boolean(error.retryable) }); }
  }
  for (const id of CHECK_IDS) {
    if (!selected.has(id)) continue;
    if (scope === "site_controls_only" && PAGE_CHECKS.has(id)) { results.push(check(id, "not_tested", "info", "This page check was not run because site-controls-only scope was selected.", [], ["Select page-and-site-controls scope to run this check."])); continue; }
    if (id === "target_fetch") results.push(targetCheck(responses.page));
    else if (id === "robots_access") results.push(robotsCheck(responses.robots, new URL(url).pathname || "/"));
    else if (id === "page_directives") results.push(directivesCheck(responses.page));
    else if (id === "page_metadata") results.push(metadataCheck(responses.page));
    else if (id === "structured_data") results.push(structuredDataCheck(responses.page));
    else if (id === "challenge_signals") results.push(challengeCheck(responses.page));
    else if (id === "sitemap") results.push(sitemapCheck(responses.sitemap, responses.sitemapDeclared));
    else if (id === "llms_txt" || id === "llms_full_txt") results.push(llmsCheck(id, responses[id]));
  }
  const remediations = [];
  for (const finding of results.filter(item => ["block", "warn", "error"].includes(item.outcome))) {
    const priority = finding.outcome === "block" ? "p0" : finding.outcome === "error" ? "p1" : "p2";
    const suffix = finding.id.replace(/_/g, "-").toUpperCase();
    const actions = {
      target_fetch: "Return the intended public HTML page with a successful HTTPS response.", robots_access: "Review the effective robots.txt group and change only the rules that should allow this public path.",
      page_directives: "Remove unintended noindex, none, or nosnippet directives from the response header or page metadata.", page_metadata: "Add or correct the title, description, canonical URL, and meaningful server-delivered text.",
      structured_data: "Correct malformed JSON-LD and validate it as data before publishing.", sitemap: "Publish a bounded, well-formed sitemap and declare it in robots.txt when appropriate.",
      llms_txt: "Publish an optional plain-text or Markdown llms.txt file, or remove a misleading HTML fallback.", llms_full_txt: "Publish an optional plain-text or Markdown llms-full.txt file, or remove a misleading HTML fallback.",
      challenge_signals: "Allow the intended public page response through the challenge layer for the relevant public crawler traffic.",
    };
    remediations.push(remediation(`REM-${suffix}-001`, [finding.id], priority, `Address ${finding.title.toLowerCase()}`, actions[finding.id], `Run the same ${finding.id} check again after independently updating the site.`));
  }
  const counts = { blockers: results.filter(item => item.outcome === "block").length, warnings: results.filter(item => item.outcome === "warn").length, passed: results.filter(item => item.outcome === "pass").length, notTested: results.filter(item => ["not_tested", "error"].includes(item.outcome)).length };
  const partial = errors.length > 0 || counts.notTested > 0;
  const status = partial ? "incomplete" : counts.blockers ? "blocking_issues_found" : counts.warnings ? "warnings_only" : "no_issues_detected_within_scope";
  const result = {
    schemaVersion: "1.0", auditEngineVersion: "1.0.0", target: { url: redactUrl(finalUrl), displayUrl: redactUrl(finalUrl), origin: finalOrigin, scope },
    startedAt, completedAt: new Date().toISOString(), status,
    summary: { ...counts, statement: status === "no_issues_detected_within_scope" ? `No issues were detected within the selected scope. ${DISCLAIMER}` : `${counts.blockers} blocking issue(s), ${counts.warnings} warning(s), ${counts.passed} pass(es), and ${counts.notTested} untested or errored check(s).` },
    checks: results, remediations,
    requestUsage: { ...context.usage, durationMs: Date.now() - started }, partial, errors,
    disclaimers: [DISCLAIMER, "The service retains no audit URL or page content after the request completes.", "llms.txt is an optional emerging convention, not an official ranking requirement."],
  };
  return enforceResultLimit(result);
}

export function enforceResultLimit(result) {
  let encoded = JSON.stringify(result);
  if (Buffer.byteLength(encoded) <= LIMITS.resultBytes) return result;
  const clone = structuredClone(result); clone.partial = true; clone.errors.push({ checkId: null, code: "RESULT_TRUNCATED", message: "Evidence was reduced to stay within the 130 KiB widget payload limit.", retryable: false });
  for (const finding of clone.checks.filter(item => item.outcome === "pass")) finding.evidence = [];
  encoded = JSON.stringify(clone);
  if (Buffer.byteLength(encoded) <= LIMITS.resultBytes) return clone;
  for (const finding of clone.checks) for (const item of finding.evidence) item.excerpt = null;
  encoded = JSON.stringify(clone);
  if (Buffer.byteLength(encoded) <= LIMITS.resultBytes) return clone;
  for (const finding of clone.checks) finding.evidence = finding.evidence.slice(0, 1);
  return clone;
}

export function auditText(result) {
  const labels = { blocking_issues_found: "blocking issues found", warnings_only: "warnings only", no_issues_detected_within_scope: "no issues detected within scope", incomplete: "incomplete" };
  const sections = [`Audit status: ${labels[result.status]}.`, `Target: ${result.target.displayUrl}`, `Checked: ${result.checks.map(item => item.title).join(", ") || "No checks completed"}.`];
  for (const [heading, outcomes] of [["Blocked", ["block"]], ["Warnings", ["warn", "error"]], ["Passed", ["pass"]], ["Not tested", ["not_tested"]]]) {
    const items = result.checks.filter(item => outcomes.includes(item.outcome));
    if (items.length) sections.push(`${heading}:\n${items.map(item => `- ${item.explanation}${item.evidence[0] ? ` Evidence: ${item.evidence[0].sourceUrl}, HTTP ${item.evidence[0].httpStatus ?? "unknown"}, observed ${item.evidence[0].observed}.` : ""}`).join("\n")}`);
  }
  if (result.remediations.length) sections.push(`Remediations:\n${result.remediations.map(item => `- ${item.id}: ${item.action} Verification: ${item.verification}`).join("\n")}`);
  sections.push(`Requests: ${result.requestUsage.requestsMade}; downloaded bytes: ${result.requestUsage.downloadedBytes}; duration: ${result.requestUsage.durationMs} ms.`);
  sections.push(result.disclaimers.join("\n"));
  sections.push("Reply with remediation IDs for implementation guidance. No website changes have been made.");
  return sections.join("\n\n");
}
