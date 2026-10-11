import { safeFetch, validatePublicUrl } from "./security.mjs";
import { load } from "cheerio";

export const SOURCE_REGISTRY = Object.freeze({
  us_data_gov: Object.freeze({
    id: "us_data_gov", label: "US Data.gov", catalogOrigin: "https://catalog.data.gov",
    catalogOrigins: new Set(["https://catalog.data.gov"]),
    downloadOrigins: new Set(["https://catalog.data.gov", "https://data.cdc.gov", "https://data.transportation.gov", "https://www2.census.gov", "https://download.bls.gov", "https://geohub.oregon.gov"]),
    publisherBase: "https://catalog.data.gov/dataset/",
  }),
  uk_data_gov: Object.freeze({
    id: "uk_data_gov", label: "UK Data.gov.uk", catalogOrigin: "https://ckan.publishing.service.gov.uk",
    catalogOrigins: new Set(["https://ckan.publishing.service.gov.uk"]),
    downloadOrigins: new Set(["https://ckan.publishing.service.gov.uk", "https://assets.publishing.service.gov.uk", "https://data.london.gov.uk"]),
    publisherBase: "https://www.data.gov.uk/dataset/",
  }),
  world_bank: Object.freeze({
    id: "world_bank", label: "World Bank Open Data", catalogOrigin: "https://api.worldbank.org",
    catalogOrigins: new Set(["https://api.worldbank.org", "https://datacatalogapi.worldbank.org"]),
    downloadOrigins: new Set(["https://api.worldbank.org", "https://datacatalogapi.worldbank.org"]),
    publisherBase: "https://data.worldbank.org/indicator/",
  }),
});

const clean = (value, max = 2000) => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const iso = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
const ref = (source, id) => `${source}:${encodeURIComponent(String(id)).replaceAll("%", "~")}`;
export const decodeRef = value => {
  const match = /^([a-z_]+):([A-Za-z0-9._~-]{1,540})$/.exec(String(value));
  if (!match || !SOURCE_REGISTRY[match[1]]) throw new Error("INVALID_REFERENCE");
  return { source: match[1], id: decodeURIComponent(match[2].replaceAll("~", "%")) };
};

async function jsonFetch(url, origins, options = {}) {
  const result = await safeFetch(url, { allowedOrigins: origins, maxBytes: options.maxBytes || 8 * 1024 * 1024, fetchImpl: options.fetchImpl, lookup: options.lookup });
  try { return JSON.parse(result.buffer.toString("utf8")); } catch { throw new Error("INVALID_UPSTREAM_JSON"); }
}

async function textFetch(url, origins, options = {}) {
  const result = await safeFetch(url, { allowedOrigins: origins, maxBytes: options.maxBytes || 8 * 1024 * 1024, fetchImpl: options.fetchImpl, lookup: options.lookup, headers: { accept: "text/html" } });
  return result.buffer.toString("utf8");
}

async function searchUsCatalog(query, page, options) {
  const registry = SOURCE_REGISTRY.us_data_gov;
  const html = await textFetch(`${registry.catalogOrigin}/?q=${encodeURIComponent(query)}&page=${page}`, registry.catalogOrigins, options);
  const $ = load(html); const results = [];
  $("li.organization-datasets__item").slice(0, 20).each((_, node) => {
    const item = $(node); const link = item.find("h3 a[href^='/dataset/']").first();
    const pathname = new URL(link.attr("href") || "/", registry.catalogOrigin).pathname;
    const id = decodeURIComponent(pathname.replace(/^\/dataset\//, ""));
    if (!id) return;
    const formats = [...new Set(item.find("[data-format]").map((__, element) => clean($(element).attr("data-format"), 30).toUpperCase()).get())].slice(0, 12);
    const meta = item.find(".usa-collection__meta-item").map((__, element) => clean($(element).text(), 300)).get();
    const publisher = clean(item.find(".usa-collection__meta-item a").first().text() || "Official publisher", 160);
    const updatedText = meta.find(value => /last updated/i.test(value))?.replace(/^.*updated:\s*/i, "");
    results.push({ dataset_ref: ref("us_data_gov", id), title: clean(link.text(), 300), publisher, description: clean(item.find(".usa-collection__description").text(), 600), updated_at: iso(updatedText), license_label: "Unknown", formats, official_page: `${registry.publisherBase}${encodeURIComponent(id)}` });
  });
  return { results, page, has_more: $("a[aria-label*='Next'], a.usa-pagination__next-page").length > 0 };
}

function formatFromEncoding(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("csv")) return "CSV";
  if (text.includes("ndjson") || text.includes("jsonl")) return "JSONL";
  if (text.includes("json")) return "JSON";
  if (text.includes("zip")) return "ZIP";
  return clean(value, 30).toUpperCase();
}

async function inspectUsCatalog(id, options) {
  const registry = SOURCE_REGISTRY.us_data_gov;
  const html = await textFetch(`${registry.publisherBase}${encodeURIComponent(id)}`, registry.catalogOrigins, options);
  const $ = load(html); const script = $("script[type='application/ld+json']").first().text();
  let item; try { item = JSON.parse(script); } catch { throw new Error("CATALOG_RESPONSE_INVALID"); }
  const publisher = clean(typeof item.publisher === "string" ? item.publisher : item.publisher?.name || item.creator?.name || "Official publisher", 160);
  const license = clean(typeof item.license === "string" ? item.license : item.license?.name || "Unknown", 160);
  const resources = [];
  for (const [index, distribution] of (Array.isArray(item.distribution) ? item.distribution : []).entries()) {
    const url = distribution.contentUrl || distribution.url; const format = formatFromEncoding(distribution.encodingFormat || distribution.fileFormat);
    if (!url || !["CSV", "JSON", "JSONL", "NDJSON", "ZIP"].includes(format)) continue;
    let exportable = false; try { await validatePublicUrl(url, registry.downloadOrigins, options.lookup); exportable = true; } catch {}
    resources.push({ resource_ref: ref("us_data_gov", `${id}|${index}`), name: clean(distribution.name || distribution.description || `${format} resource`, 200), source_format: format, declared_bytes: Number.isSafeInteger(Number(distribution.contentSize)) ? Number(distribution.contentSize) : null, estimated_rows: null, exportable, blocked_reason: exportable ? null : "Resource host is outside this adapter's reviewed allowlist." });
  }
  return { raw: item, dataset: { dataset_ref: ref("us_data_gov", id), title: clean(item.name || item.headline || id, 300), publisher, official_page: `${registry.publisherBase}${encodeURIComponent(id)}`, description: clean(item.description, 600), updated_at: iso(item.dateModified), license_label: license }, resources: resources.slice(0, 50) };
}

function ckanResult(source, item) {
  const formats = [...new Set((item.resources || []).map(resource => clean(resource.format, 30).toUpperCase()).filter(Boolean))].slice(0, 12);
  return {
    dataset_ref: ref(source, item.id || item.name), title: clean(item.title || item.name, 300),
    publisher: clean(item.organization?.title || item.maintainer || "Official publisher", 160),
    description: clean(item.notes, 600), updated_at: iso(item.metadata_modified),
    license_label: clean(item.license_title || item.license_id || "Unknown", 160), formats,
    official_page: source === "us_data_gov" ? `${SOURCE_REGISTRY[source].publisherBase}${encodeURIComponent(item.name || item.id)}` : `${SOURCE_REGISTRY[source].publisherBase}${encodeURIComponent(item.name || item.id)}`,
  };
}

async function searchCkan(source, query, page, options) {
  const registry = SOURCE_REGISTRY[source];
  const start = (page - 1) * 20;
  const url = `${registry.catalogOrigin}/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=20&start=${start}`;
  const payload = await jsonFetch(url, registry.catalogOrigins, options);
  if (!payload.success || !payload.result) throw new Error("CATALOG_RESPONSE_INVALID");
  return { results: payload.result.results.map(item => ckanResult(source, item)), page, has_more: start + payload.result.results.length < Number(payload.result.count || 0) };
}

async function inspectCkan(source, id, options) {
  const registry = SOURCE_REGISTRY[source];
  const payload = await jsonFetch(`${registry.catalogOrigin}/api/3/action/package_show?id=${encodeURIComponent(id)}`, registry.catalogOrigins, options);
  if (!payload.success || !payload.result) throw new Error("DATASET_NOT_FOUND");
  const item = payload.result;
  const dataset = ckanResult(source, item);
  const resources = [];
  for (const resource of item.resources || []) {
    const format = clean(resource.format, 30).toUpperCase();
    if (!resource.url || !["CSV", "JSON", "JSONL", "NDJSON", "ZIP"].includes(format)) continue;
    let exportable = false;
    try { await validatePublicUrl(resource.url, registry.downloadOrigins, options.lookup); exportable = true; } catch {}
    resources.push({
      resource_ref: ref(source, `${id}|${resource.id}`), name: clean(resource.name || resource.description || format, 200),
      source_format: format, declared_bytes: Number.isSafeInteger(Number(resource.size)) ? Number(resource.size) : null,
      estimated_rows: null, exportable, blocked_reason: exportable ? null : "Resource host is outside this adapter's reviewed allowlist.",
    });
  }
  return { raw: item, dataset: { ...dataset, dataset_ref: ref(source, id) }, resources: resources.slice(0, 50) };
}

async function resolveCkanResource(source, compoundId, options) {
  const separator = compoundId.lastIndexOf("|");
  if (separator < 1) throw new Error("INVALID_RESOURCE_REFERENCE");
  const datasetId = compoundId.slice(0, separator);
  const resourceId = compoundId.slice(separator + 1);
  const inspected = await inspectCkan(source, datasetId, options);
  const resource = (inspected.raw.resources || []).find(item => String(item.id) === resourceId);
  if (!resource) throw new Error("RESOURCE_NOT_FOUND");
  await validatePublicUrl(resource.url, SOURCE_REGISTRY[source].downloadOrigins, options.lookup);
  return { url: resource.url, format: clean(resource.format, 30).toUpperCase(), name: clean(resource.name || resourceId, 200), dataset: inspected };
}

async function searchWorldBank(query, page, options) {
  const payload = await jsonFetch(`https://api.worldbank.org/v2/indicator?format=json&per_page=1000&page=${page}`, SOURCE_REGISTRY.world_bank.catalogOrigins, options);
  const items = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = items.filter(item => terms.every(term => `${item.id} ${item.name} ${item.source?.value || ""}`.toLowerCase().includes(term))).slice(0, 20);
  return {
    results: matches.map(item => ({
      dataset_ref: ref("world_bank", item.id), title: clean(item.name, 300), publisher: clean(item.source?.value || "World Bank", 160),
      description: clean(item.sourceNote, 600), updated_at: null, license_label: "CC BY 4.0", formats: ["JSON", "CSV"],
      official_page: `${SOURCE_REGISTRY.world_bank.publisherBase}${encodeURIComponent(item.id)}`,
    })), page, has_more: false,
  };
}

async function inspectWorldBank(id, options) {
  const payload = await jsonFetch(`https://api.worldbank.org/v2/indicator/${encodeURIComponent(id)}?format=json`, SOURCE_REGISTRY.world_bank.catalogOrigins, options);
  const item = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1][0] : null;
  if (!item) throw new Error("DATASET_NOT_FOUND");
  return {
    raw: { ...item, license_url: "https://data.worldbank.org/summary-terms-of-use" },
    dataset: { dataset_ref: ref("world_bank", id), title: clean(item.name, 300), publisher: clean(item.source?.value || "World Bank", 160), description: clean(item.sourceNote, 600), updated_at: null, license_label: "CC BY 4.0", official_page: `${SOURCE_REGISTRY.world_bank.publisherBase}${encodeURIComponent(id)}` },
    resources: [{ resource_ref: ref("world_bank", id), name: `${clean(item.name, 160)} API data`, source_format: "JSON", declared_bytes: null, estimated_rows: null, exportable: true, blocked_reason: null }],
  };
}

export async function searchSource(source, query, page, options = {}) {
  if (source === "world_bank") return searchWorldBank(query, page, options);
  if (source === "us_data_gov") return searchUsCatalog(query, page, options);
  if (source === "uk_data_gov") return searchCkan(source, query, page, options);
  throw new Error("UNKNOWN_SOURCE");
}

export async function inspectDataset(datasetRef, options = {}) {
  const { source, id } = decodeRef(datasetRef);
  if (source === "world_bank") return inspectWorldBank(id, options);
  if (source === "us_data_gov") return inspectUsCatalog(id, options);
  return inspectCkan(source, id, options);
}

export async function resolveResource(datasetRef, resourceRef, options = {}) {
  const dataset = decodeRef(datasetRef);
  const resource = decodeRef(resourceRef);
  if (dataset.source !== resource.source) throw new Error("CROSS_ADAPTER_REFERENCE");
  if (dataset.source === "world_bank") {
    if (dataset.id !== resource.id) throw new Error("RESOURCE_NOT_IN_DATASET");
    const inspected = await inspectWorldBank(dataset.id, options);
    return { url: `https://api.worldbank.org/v2/country/all/indicator/${encodeURIComponent(dataset.id)}?format=json&per_page=20000`, format: "JSON", name: dataset.id, dataset: inspected };
  }
  if (!resource.id.startsWith(`${dataset.id}|`)) throw new Error("RESOURCE_NOT_IN_DATASET");
  if (dataset.source === "us_data_gov") {
    const inspected = await inspectUsCatalog(dataset.id, options);
    const index = Number(resource.id.slice(resource.id.lastIndexOf("|") + 1));
    const distribution = inspected.raw.distribution?.[index];
    const url = distribution?.contentUrl || distribution?.url;
    if (!url) throw new Error("RESOURCE_NOT_FOUND");
    await validatePublicUrl(url, SOURCE_REGISTRY.us_data_gov.downloadOrigins, options.lookup);
    return { url, format: formatFromEncoding(distribution.encodingFormat || distribution.fileFormat), name: clean(distribution.name || `resource-${index}`, 200), dataset: inspected };
  }
  return resolveCkanResource(dataset.source, resource.id, options);
}
