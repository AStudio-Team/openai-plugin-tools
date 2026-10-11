export const CHECK_IDS = [
  "target_fetch", "robots_access", "page_directives", "page_metadata",
  "structured_data", "sitemap", "llms_txt", "llms_full_txt", "challenge_signals",
];
export const PAGE_CHECKS = new Set(["target_fetch", "page_directives", "page_metadata", "structured_data", "challenge_signals"]);
export const REQUEST_BUDGET = Object.freeze({ maximumRequests: 8, maximumDownloadedBytes: 9 * 1024 * 1024, maximumDurationMs: 30_000 });
export const VALIDATION_BUDGET = Object.freeze({ maximumRequests: 2, maximumDownloadedBytes: 4 * 1024 * 1024, maximumDurationMs: 20_000 });
export const LIMITS = Object.freeze({
  redirects: 5,
  connectTimeoutMs: 3_000,
  requestTimeoutMs: 10_000,
  htmlBytes: 2 * 1024 * 1024,
  controlBytes: 1 * 1024 * 1024,
  sitemapBytes: 2 * 1024 * 1024,
  sitemapEntries: 5_000,
  jsonLdBlocks: 50,
  jsonLdBlockBytes: 100 * 1024,
  resultBytes: 130 * 1024,
});
export const CRAWLER_TOKENS = ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Google-Extended", "PerplexityBot"];
export const USER_AGENT = "AI-Crawler-Readiness-Auditor/1.0 (+https://www.astudio.agency/tools/ai-crawler-readiness-auditor)";
export const DISCLAIMER = "This audit checks public technical signals only. It does not measure or guarantee inclusion, citations, traffic, model training, or ranking in any AI product.";
