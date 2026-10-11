#!/usr/bin/env node
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ipaddr from "ipaddr.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const CONVERTER = path.join(ROOT, "src", "convert_pdf.py");
const PORT = Number(process.env.PORT || 8788);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_CONVERSIONS || 2);
const CONVERSION_TIMEOUT_MS = Number(process.env.CONVERSION_TIMEOUT_MS || 45_000);
const DOWNLOAD_TTL_MS = Number(process.env.DOWNLOAD_TTL_MS || 15 * 60_000);
const MAX_STORED_FILES = Number(process.env.MAX_STORED_FILES || 10);
const MAX_STORED_BYTES = Number(process.env.MAX_STORED_BYTES || 100 * 1024 * 1024);
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_CLIENT = Number(process.env.RATE_LIMIT_PER_CLIENT || 10);
const RATE_LIMIT_GLOBAL = Number(process.env.RATE_LIMIT_GLOBAL || 120);
const ALLOWED_HOSTS = new Set((process.env.ALLOWED_HOSTS || "127.0.0.1,localhost,www.astudio.agency,astudio.agency").split(",").map(v => v.trim().toLowerCase()).filter(Boolean));
const downloads = new Map();
const rateBuckets = new Map();
let storedBytes = 0;
let activeConversions = 0;

function logEvent(event, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }));
}

function errorCategory(message) {
  const value = String(message || "").toLowerCase();
  if (value.includes("limit") || value.includes("exceed")) return "limit_rejected";
  if (value.includes("publicly reachable") || value.includes("https")) return "url_rejected";
  if (value.includes("not a pdf") || value.includes("provide a pdf")) return "file_rejected";
  if (value.includes("no extractable tables")) return "no_tables";
  if (value.includes("busy") || value.includes("capacity")) return "capacity_rejected";
  if (value.includes("download")) return "download_failed";
  return "conversion_failed";
}

const openAiFileSchema = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
}).strict();

const outputSchema = {
  filename: z.string(),
  pages: z.number().int().positive(),
  tables: z.number().int().positive(),
  download_url: z.string().url(),
  expires_in_seconds: z.number().int().positive(),
  previews: z.array(z.object({
    page: z.number().int().positive(),
    table: z.number().int().positive(),
    worksheet: z.string(),
    rows: z.number().int().positive(),
    columns: z.number().int().nonnegative(),
  })),
};

function isPublicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

async function resolvePublicHttps(urlValue) {
  const url = new URL(urlValue);
  if (url.protocol !== "https:") throw new Error("The PDF download URL must use HTTPS.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const records = ipaddr.isValid(hostname)
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === "ipv6" ? 6 : 4 }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => !isPublicAddress(record.address))) {
    throw new Error("The PDF download URL is not publicly reachable.");
  }
  return { url, address: records[0].address, family: records[0].family };
}

function pinnedHttpsRequest(target) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: "https:",
      hostname: target.url.hostname,
      port: target.url.port || 443,
      path: `${target.url.pathname}${target.url.search}`,
      method: "GET",
      headers: { "user-agent": "ASTUDIO-PDF-Table-to-Excel/1.0" },
      servername: target.url.hostname,
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, [{ address: target.address, family: target.family }]);
        else callback(null, target.address, target.family);
      },
    }, resolve);
    request.setTimeout(20_000, () => request.destroy(new Error("PDF download timed out.")));
    request.on("error", reject);
    request.end();
  });
}

export async function downloadPdf(urlValue, maxRedirects = 3) {
  let target = await resolvePublicHttps(urlValue);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await pinnedHttpsRequest(target);
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      response.resume();
      if (!location || redirects === maxRedirects) throw new Error("The PDF download redirected too many times.");
      target = await resolvePublicHttps(new URL(location, target.url).toString());
      continue;
    }
    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
      response.resume();
      throw new Error(`Could not download the PDF, HTTP ${response.statusCode || 0}.`);
    }
    const declared = Number(response.headers["content-length"] || 0);
    if (declared > MAX_DOWNLOAD_BYTES) {
      response.destroy();
      throw new Error("PDF exceeds the 20 MB limit.");
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of response) {
      total += chunk.length;
      if (total > MAX_DOWNLOAD_BYTES) {
        response.destroy();
        throw new Error("PDF exceeds the 20 MB limit.");
      }
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    if (!data.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("The selected file is not a PDF.");
    return data;
  }
  throw new Error("Could not download the PDF.");
}

export function convertPdf(pdfBytes) {
  if (activeConversions >= MAX_CONCURRENT) return Promise.reject(new Error("The converter is busy. Try again shortly."));
  activeConversions += 1;
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || "python3", [CONVERTER, "--base64-json"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeConversions -= 1;
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(reject, new Error(`Conversion exceeded the ${CONVERSION_TIMEOUT_MS} ms limit.`));
    }, CONVERSION_TIMEOUT_MS);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", processError => finish(reject, processError));
    child.on("close", code => {
      try {
        const parsed = JSON.parse(stdout || "{}");
        if (code !== 0 || !parsed.ok) finish(reject, new Error(parsed.error || stderr || "Conversion failed."));
        else finish(resolve, parsed);
      } catch (parseError) {
        finish(reject, new Error(stderr || parseError.message));
      }
    });
    child.stdin.end(JSON.stringify({ pdf_base64: pdfBytes.toString("base64") }));
  });
}

function safeFilename(value) {
  const stem = String(value || "converted-tables.xlsx").replace(/\.xlsx$/i, "").replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "converted-tables";
  return `${stem}.xlsx`;
}

function removeDownload(token) {
  const item = downloads.get(token);
  if (!item) return;
  storedBytes -= item.buffer.length;
  downloads.delete(token);
}

function pruneDownloads() {
  const now = Date.now();
  for (const [token, item] of downloads) if (item.expiresAt <= now) removeDownload(token);
  while (downloads.size > MAX_STORED_FILES || storedBytes > MAX_STORED_BYTES) removeDownload(downloads.keys().next().value);
}

function storeDownload(buffer, filename) {
  if (buffer.length > MAX_STORED_BYTES) throw new Error("Generated workbook exceeds the temporary storage limit.");
  pruneDownloads();
  const token = randomBytes(24).toString("hex");
  downloads.set(token, { buffer, filename, expiresAt: Date.now() + DOWNLOAD_TTL_MS });
  storedBytes += buffer.length;
  pruneDownloads();
  if (!downloads.has(token)) throw new Error("Temporary download capacity is full. Try again shortly.");
  return `${PUBLIC_BASE_URL}/downloads/${token}/${encodeURIComponent(filename)}`;
}

export function createPluginServer() {
  const server = new McpServer({ name: "pdf-table-to-excel", version: "1.0.0" });
  server.registerTool(
    "convert_pdf_tables_to_excel",
    {
      title: "Convert PDF tables to Excel",
      description: "Converts selectable tables in one user-provided PDF into a clean XLSX workbook. Use it only when the user explicitly asks to extract or convert PDF tables. It does not perform OCR on scanned image-only PDFs. The output download expires after 15 minutes.",
      inputSchema: {
        file: openAiFileSchema.describe("The PDF selected or uploaded by the user."),
        output_filename: z.string().max(90).optional().describe("Optional XLSX filename."),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: true,
      },
      _meta: {
        "openai/fileParams": ["file"],
        "openai/toolInvocation/invoking": "Converting PDF tables",
        "openai/toolInvocation/invoked": "Excel workbook ready",
      },
    },
    async ({ file, output_filename }) => {
      const startedAt = Date.now();
      try {
        if (file.mime_type && file.mime_type !== "application/pdf") throw new Error("Please provide a PDF file.");
        const pdfBytes = await downloadPdf(file.download_url);
        if (pdfBytes.length > MAX_PDF_BYTES) throw new Error("PDF exceeds the 20 MB limit.");
        const result = await convertPdf(pdfBytes);
        const workbook = Buffer.from(result.xlsx_base64, "base64");
        const filename = safeFilename(output_filename || file.file_name?.replace(/\.pdf$/i, "") || "converted-tables");
        const downloadUrl = storeDownload(workbook, filename);
        logEvent("conversion_completed", { duration_ms: Date.now() - startedAt, pages: result.pages, tables: result.tables, output_bytes: workbook.length });
        const structuredContent = {
          filename,
          pages: result.pages,
          tables: result.tables,
          download_url: downloadUrl,
          expires_in_seconds: Math.floor(DOWNLOAD_TTL_MS / 1000),
          previews: result.previews.map(({ page, table, worksheet, rows, columns }) => ({ page, table, worksheet, rows, columns })),
        };
        return {
          content: [{ type: "text", text: `Converted ${result.tables} table${result.tables === 1 ? "" : "s"} from ${result.pages} page${result.pages === 1 ? "" : "s"}. Download ${filename}: ${downloadUrl} The link expires in 15 minutes.` }],
          structuredContent,
        };
      } catch (error) {
        logEvent("conversion_rejected", { duration_ms: Date.now() - startedAt, category: errorCategory(error.message) });
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
    }
  );
  return server;
}

function contentType(filePath) {
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".mp4": "video/mp4", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })[path.extname(filePath)] || "application/octet-stream";
}

function serveFile(res, filePath, cacheControl = "public, max-age=300") {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  const size = statSync(filePath).size;
  res.writeHead(200, { "content-type": contentType(filePath), "content-length": size, "cache-control": cacheControl, "x-content-type-options": "nosniff" });
  createReadStream(filePath).pipe(res);
  return true;
}

function hostAllowed(req) {
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  return ALLOWED_HOSTS.has(host);
}

export function consumeRateLimit(req) {
  const now = Date.now();
  const forwarded = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown");
  const client = forwarded.split(",")[0].trim().slice(0, 80);
  const limits = [[`client:${client}`, RATE_LIMIT_PER_CLIENT], ["global", RATE_LIMIT_GLOBAL]];
  for (const [key, limit] of limits) {
    const current = rateBuckets.get(key);
    if (!current || current.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
      continue;
    }
    if (current.count >= limit) return false;
    current.count += 1;
  }
  if (rateBuckets.size > 5000) {
    for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
  return true;
}

export function createHttpServer() {
  return http.createServer(async (req, res) => {
    if (!req.url || !hostAllowed(req)) return res.writeHead(421).end("Misdirected Request");
    const url = new URL(req.url, PUBLIC_BASE_URL);
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ status: "ok", service: "pdf-table-to-excel", version: "1.0.0" }));
      return;
    }
    const staticRoutes = new Map([
      ["/", "index.html"],
      ["/pdf-table-to-excel", "pdf-table-to-excel.html"],
      ["/gcc-arabic-writer", "gcc-arabic-writer.html"],
      ["/privacy", "privacy.html"],
      ["/terms", "terms.html"],
      ["/support", "support.html"],
      ["/robots.txt", "robots.txt"],
      ["/sitemap.xml", "sitemap.xml"],
    ]);
    if (req.method === "GET" && staticRoutes.has(url.pathname)) {
      if (!serveFile(res, path.join(PUBLIC_DIR, staticRoutes.get(url.pathname)))) res.writeHead(404).end("Not Found");
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      const filePath = path.resolve(PUBLIC_DIR, `.${url.pathname}`);
      if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) || !serveFile(res, filePath, "public, max-age=86400")) res.writeHead(404).end("Not Found");
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/review/")) {
      const filePath = path.resolve(PUBLIC_DIR, `.${url.pathname}`);
      if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) || !serveFile(res, filePath, "public, max-age=3600")) res.writeHead(404).end("Not Found");
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/downloads/")) {
      pruneDownloads();
      const token = url.pathname.split("/")[2];
      const item = downloads.get(token);
      if (!item) return res.writeHead(404, { "cache-control": "no-store" }).end("Download expired or not found");
      res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${item.filename}"`,
        "content-length": item.buffer.length,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      }).end(item.buffer);
      return;
    }
    if (req.method === "OPTIONS" && url.pathname === "/mcp") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, DELETE, OPTIONS", "access-control-allow-headers": "content-type, mcp-session-id", "access-control-expose-headers": "Mcp-Session-Id" }).end();
      return;
    }
    if (url.pathname === "/mcp" && ["POST", "GET", "DELETE"].includes(req.method || "")) {
      if (!consumeRateLimit(req)) {
        logEvent("rate_limit_rejected");
        res.writeHead(429, { "content-type": "application/json", "retry-after": "60", "cache-control": "no-store" }).end(JSON.stringify({ error: "Rate limit exceeded. Try again in one minute." }));
        return;
      }
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-expose-headers", "Mcp-Session-Id");
      const server = createPluginServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close(); server.close(); });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch {
        logEvent("mcp_request_failed");
        if (!res.headersSent) res.writeHead(500).end("Internal server error");
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") {
      const token = process.env.OPENAI_APPS_CHALLENGE || "";
      if (!token) return res.writeHead(404).end("Not Found");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(token);
      return;
    }
    if (req.method === "GET" && ["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"].includes(url.pathname)) {
      res.writeHead(404).end("Not Found");
      return;
    }
    res.writeHead(404).end("Not Found");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const httpServer = createHttpServer();
  httpServer.listen(PORT, "0.0.0.0", () => logEvent("service_started", { port: PORT, version: "1.0.0" }));
}
