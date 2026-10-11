import { createHash, createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import parquet from "parquetjs-lite";
import { safeFetch, assertSafeArchive } from "./security.mjs";
import { SOURCE_REGISTRY, decodeRef, resolveResource } from "./adapters.mjs";

const GREEN_LICENSES = [/\bcc0\b/i, /\bcc by(?:-sa)?(?: 4\.0| 3\.0)?\b/i, /open government licence/i, /\bodc[- ]?by\b/i, /\bodbl\b/i, /public domain/i, /us-pd/i];
const RED_LICENSES = [/all rights reserved/i, /no redistribution/i, /not for redistribution/i, /proprietary/i, /internal use only/i];
const SECRET = process.env.FLOW_SIGNING_KEY || randomBytes(32).toString("hex");

export function classifyRights(label, url = null) {
  const text = `${label || ""} ${url || ""}`.trim();
  let verdict = "amber";
  if (RED_LICENSES.some(pattern => pattern.test(text))) verdict = "red";
  else if (GREEN_LICENSES.some(pattern => pattern.test(text))) verdict = "green";
  const green = verdict === "green";
  return {
    license_label: String(label || "Unknown").slice(0, 160), license_url: url || null,
    commercial_use: green ? "allowed" : verdict === "red" ? "restricted" : "unknown",
    redistribution: green ? "allowed" : verdict === "red" ? "restricted" : "unknown",
    attribution_required: !/cc0|public domain|us-pd/i.test(text),
    attribution_text: green ? `Source: official publisher. License: ${label}.` : "Use the publisher page to review and obtain the data under its stated terms.",
    verdict,
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function issueFlowToken(stage, payload, ttlMs = 30 * 60 * 1000) {
  const body = Buffer.from(JSON.stringify({ stage, payload: canonical(payload), expires: Date.now() + ttlMs })).toString("base64url");
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}

export function verifyFlowToken(token, stage, expected = {}) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) throw new Error("FLOW_TOKEN_REQUIRED");
  const actual = createHmac("sha256", SECRET).update(body).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== actual.length || !timingSafeEqual(supplied, actual)) throw new Error("FLOW_TOKEN_INVALID");
  const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (decoded.stage !== stage || decoded.expires < Date.now()) throw new Error("FLOW_TOKEN_EXPIRED");
  for (const [key, value] of Object.entries(expected)) if (decoded.payload[key] !== value) throw new Error("FLOW_TOKEN_SCOPE_MISMATCH");
  return decoded.payload;
}

function parseCsv(text, maxRows = 200) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length <= maxRows; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = (rows.shift() || []).map((value, index) => value.trim() || `column_${index + 1}`);
  const seen = new Map();
  const uniqueHeaders = headers.map(header => { const count = seen.get(header) || 0; seen.set(header, count + 1); return count ? `${header}_${count + 1}` : header; });
  return rows.slice(0, maxRows).map(values => Object.fromEntries(uniqueHeaders.map((header, index) => [header, values[index] ?? ""])));
}

export function parseRows(buffer, format, maxRows = 200) {
  const archive = assertSafeArchive(buffer);
  if (archive.archive) throw new Error("ARCHIVE_EXPORT_DISABLED");
  const text = buffer.toString("utf8").replace(/^\ufeff/, "");
  if (format === "CSV") return parseCsv(text, maxRows);
  let value;
  if (["JSONL", "NDJSON"].includes(format)) value = text.split(/\r?\n/).filter(Boolean).slice(0, maxRows).map(line => JSON.parse(line));
  else value = JSON.parse(text);
  if (Array.isArray(value) && Array.isArray(value[1]) && value[0]?.page !== undefined) value = value[1];
  if (!Array.isArray(value)) value = Array.isArray(value?.data) ? value.data : [value];
  return value.slice(0, maxRows).map(item => item && typeof item === "object" && !Array.isArray(item) ? item : { value: item });
}

function inferType(values) {
  const present = values.filter(value => value !== null && value !== undefined && value !== "");
  if (!present.length) return "string";
  if (present.every(value => typeof value === "boolean" || /^(true|false)$/i.test(String(value)))) return "boolean";
  if (present.every(value => Number.isFinite(Number(value)))) return "number";
  if (present.every(value => !Number.isNaN(Date.parse(value)) && /[-T:/]/.test(String(value)))) return "date";
  return "string";
}

export function summarizeRows(rows) {
  const names = [...new Set(rows.flatMap(row => Object.keys(row)))].slice(0, 250);
  const columns = names.map(name => {
    const values = rows.map(row => row[name]);
    const present = values.filter(value => value !== null && value !== undefined && value !== "");
    return { name, inferred_type: inferType(values), nullable: present.length !== values.length, null_count_sample: values.length - present.length, distinct_count_sample: new Set(present.map(String)).size, min_sample: present.length ? String([...present].sort()[0]).slice(0, 200) : null, max_sample: present.length ? String([...present].sort().at(-1)).slice(0, 200) : null };
  });
  const serialized = rows.map(row => JSON.stringify(canonical(row)));
  return { columns, rows, quality: { sample_size: rows.length, duplicate_rows_sample: serialized.length - new Set(serialized).size, empty_columns: columns.filter(column => column.null_count_sample === rows.length).map(column => column.name), mixed_type_columns: [], encoding: "UTF-8", delimiter: ",", warnings: [] } };
}

export async function fetchPreview(datasetRef, resourceRef, sampleRows, options = {}) {
  const resolved = await resolveResource(datasetRef, resourceRef, options);
  const source = decodeRef(datasetRef).source;
  const fetched = await safeFetch(resolved.url, { allowedOrigins: SOURCE_REGISTRY[source].downloadOrigins, maxBytes: 5 * 1024 * 1024, timeoutMs: 30_000, fetchImpl: options.fetchImpl, lookup: options.lookup });
  return { ...summarizeRows(parseRows(fetched.buffer, resolved.format, sampleRows)), source_format: resolved.format };
}

function matchesFilter(value, operator, expected) {
  if (operator === "is_null") return value === null || value === undefined || value === "";
  const a = value ?? "";
  if (operator === "contains") return String(a).toLowerCase().includes(String(expected).toLowerCase());
  if (operator === "starts_with") return String(a).toLowerCase().startsWith(String(expected).toLowerCase());
  if (operator === "eq") return String(a) === String(expected);
  if (operator === "neq") return String(a) !== String(expected);
  const left = Number(a); const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return operator === "lt" ? left < right : operator === "lte" ? left <= right : operator === "gt" ? left > right : left >= right;
}

const csvCell = value => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+@\t\r]/.test(text) || /^-(?!\d)/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

async function serialize(rows, columns, format) {
  if (format === "csv") return Buffer.from(`${columns.map(csvCell).join(",")}\n${rows.map(row => columns.map(column => csvCell(row[column])).join(",")).join("\n")}\n`);
  if (format === "jsonl") return Buffer.from(`${rows.map(row => JSON.stringify(Object.fromEntries(columns.map(column => [column, row[column] ?? null])))).join("\n")}\n`);
  const fields = Object.fromEntries(columns.map(column => [column, { type: "UTF8", optional: true }]));
  const file = path.join(tmpdir(), `open-data-${randomBytes(10).toString("hex")}.parquet`);
  const writer = await parquet.ParquetWriter.openFile(new parquet.ParquetSchema(fields), file);
  try { for (const row of rows) await writer.appendRow(Object.fromEntries(columns.map(column => [column, row[column] === undefined || row[column] === null ? undefined : String(row[column])]))); }
  finally { await writer.close(); }
  try { return await readFile(file); } finally { await unlink(file).catch(() => {}); }
}

export async function createExport(input, options = {}) {
  const resolved = await resolveResource(input.dataset_ref, input.resource_ref, options);
  const source = decodeRef(input.dataset_ref).source;
  const fetched = await safeFetch(resolved.url, { allowedOrigins: SOURCE_REGISTRY[source].downloadOrigins, maxBytes: 250 * 1024 * 1024, timeoutMs: 10 * 60_000, fetchImpl: options.fetchImpl, lookup: options.lookup });
  let rows = parseRows(fetched.buffer, resolved.format, input.row_limit);
  rows = rows.filter(row => (input.filters || []).every(filter => matchesFilter(row[filter.column], filter.operator, filter.value))).slice(0, input.row_limit);
  const selected = input.selected_columns;
  if (rows.some(row => selected.some(column => !(column in row)))) throw new Error("UNKNOWN_SELECTED_COLUMN");
  const content = await serialize(rows, selected, input.format);
  if (content.length > 250 * 1024 * 1024) throw new Error("ARTIFACT_SIZE_LIMIT");
  return { content, rows: rows.length, columns: selected.length, sha256: createHash("sha256").update(content).digest("hex"), mimeType: input.format === "csv" ? "text/csv" : input.format === "jsonl" ? "application/x-ndjson" : "application/vnd.apache.parquet", extension: input.format === "jsonl" ? "jsonl" : input.format };
}
