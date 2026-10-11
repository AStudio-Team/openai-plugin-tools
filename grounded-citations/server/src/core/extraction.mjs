import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { unzipSync } from "fflate";

export const EXTRACTION_LIMITS = { maxSourceChars: 200_000 };
const MIME = new Set(["text/plain", "text/markdown", "text/html", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

export async function extractSource(buffer, declaredMime = "", options = {}) {
  const maxChars = options.maxSourceChars || EXTRACTION_LIMITS.maxSourceChars;
  const mime = detectMime(buffer, declaredMime);
  if (!MIME.has(mime)) throw extractionError("unsupported_mime", "Supported types are HTML, text, Markdown, PDF and DOCX.");
  let text = ""; let title = ""; let extractionLimited = false;
  if (mime === "application/pdf") {
    const doc = await getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false }).promise;
    const pages = []; const pageLimit = Math.min(doc.numPages, 500); extractionLimited = doc.numPages > pageLimit;
    for (let index = 1; index <= pageLimit && pages.join("\n").length <= maxChars; index += 1) {
      const page = await doc.getPage(index); const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str || "").join(" "));
    }
    text = pages.join("\n");
  } else if (mime.includes("wordprocessingml")) {
    enforceDocxBudget(buffer);
    let entries;
    try { entries = unzipSync(new Uint8Array(buffer), { filter: file => file.name === "word/document.xml" }); }
    catch { throw extractionError("invalid_docx", "DOCX archive could not be read."); }
    const document = entries["word/document.xml"];
    if (!document || document.length > 10 * 1024 * 1024) throw extractionError("invalid_docx", "DOCX document content is missing or exceeds the expanded limit.");
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(document);
    text = decodeEntities(xml.replace(/<w:(?:tab|br)\b[^>]*\/?\s*>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, " "));
  } else {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (mime === "text/html") { title = sanitizeLabel(decodeEntities((decoded.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")); text = htmlToText(decoded); }
    else text = decoded;
  }
  text = normalizeExtractedText(text);
  const truncated = extractionLimited || text.length > maxChars;
  return { mime, title, text: text.slice(0, maxChars), truncated, digest: createHash("sha256").update(text.slice(0, maxChars)).digest("hex") };
}

export function detectMime(buffer, declared = "") {
  const claim = String(declared || "").split(";")[0].toLowerCase();
  if (claim && !MIME.has(claim)) throw extractionError("unsupported_mime", "Declared MIME type is not supported.");
  let magic;
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") magic = "application/pdf";
  else if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) magic = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  else {
    if (buffer.includes(0)) throw extractionError("binary_content", "Binary content does not match a supported file type.");
    const sample = buffer.subarray(0, 4096).toString("utf8").trimStart().toLowerCase();
    magic = sample.startsWith("<!doctype html") || sample.startsWith("<html") || (claim === "text/html" && sample.startsWith("<")) ? "text/html" : claim === "text/markdown" ? "text/markdown" : "text/plain";
  }
  if (claim && MIME.has(claim) && claim !== magic && !(claim === "text/plain" && magic === "text/plain")) throw extractionError("mime_mismatch", "Declared MIME type does not match the file signature.");
  return magic;
}

export function enforceDocxBudget(buffer) {
  const target = "word/document.xml"; let found = false;
  for (let offset = 0; offset + 46 <= buffer.length; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    const compressed = buffer.readUInt32LE(offset + 20); const expanded = buffer.readUInt32LE(offset + 24); const nameLength = buffer.readUInt16LE(offset + 28); const extraLength = buffer.readUInt16LE(offset + 30); const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === target) { found = true; if (expanded > 10 * 1024 * 1024 || expanded > Math.max(compressed, 1) * 100) throw extractionError("compression_bomb", "DOCX expanded content exceeds safe limits."); }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  if (!found) throw extractionError("invalid_docx", "DOCX document content is missing.");
}

function htmlToText(html) {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|iframe|object|embed|svg|math|title)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]+>/g, " "));
}
function decodeEntities(text) { return text.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))); }
export function normalizeExtractedText(value) { return String(value).normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
export function sanitizeLabel(value) { return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 500); }
export function extractionError(code, message) { return Object.assign(new Error(message), { code }); }
