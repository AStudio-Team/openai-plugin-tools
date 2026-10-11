const ENTITIES = new Map([["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", "\""], ["apos", "'"], ["nbsp", " "]]);
export function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_all, token) => {
    if (token[0] === "#") {
      const point = token[1].toLowerCase() === "x" ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }
    return ENTITIES.get(token.toLowerCase()) || "";
  });
}
export function plain(value, max = 240) {
  return decodeEntities(String(value || "").replace(/<[^>]*>/g, " ")).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
export function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function extractTag(html, tag) {
  const match = String(html).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? plain(match[1], 500) : "";
}
export function extractAttr(tagText, name) {
  const match = String(tagText).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim() : "";
}
export function visibleText(html) {
  return plain(String(html).replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--([\s\S]*?)-->/g, " "), 20_000);
}
