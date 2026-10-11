#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.env.PORT || 8790);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 256 * 1024);
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_CLIENT = Number(process.env.RATE_LIMIT_PER_CLIENT || 30);
const RATE_LIMIT_GLOBAL = Number(process.env.RATE_LIMIT_GLOBAL || 300);
const MAX_CONCURRENT_PER_CLIENT = Number(process.env.MAX_CONCURRENT_PER_CLIENT || 3);
const TOOL_TIMEOUT_MS = Number(process.env.TOOL_TIMEOUT_MS || 10_000);
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE || "configure-before-production";
const ALLOWED_HOSTS = new Set((process.env.ALLOWED_HOSTS || "127.0.0.1,localhost,www.astudio.agency,astudio.agency").split(",").map(item => item.trim().toLowerCase()).filter(Boolean));
const rateBuckets = new Map();
const activeByClient = new Map();
const CHANNELS = ["content", "seo", "email", "organic_social", "partnerships", "events", "paid_search", "paid_social"];
const OBJECTIVES = ["brand_awareness", "qualified_leads", "trial_or_demo_demand", "direct_sales", "other"];
const NOTICE = "Your brief is processed to create this plan. The planner does not connect to marketing accounts, perform tracking, or intentionally retain your brief or exported plan. Avoid entering secrets, personal customer data, or confidential material.";
const EXCLUDED = ["Account access or campaign launch", "Tracking or performance monitoring", "Scraping or live market research", "Unsolicited bulk outreach", "Guaranteed outcomes"];
const FORBIDDEN_REQUEST = /(?:invent|fabricat(?:e|ed)|fake)\s+(?:testimonial|review|proof)|vulnerable\s+(?:elderly|people|users)|scrape\s+(?:competitor|website)|launch\s+(?:the\s+)?campaign|connect\s+to\s+(?:google|meta|ad)|guarantee(?:d)?\s+(?:revenue|result|ranking)|unsolicited\s+bulk/iu;
const PERFORMANCE_CLAIM = /(?:\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?x\b|guaranteed|proven to deliver|will increase|will rank|industry-leading)/iu;
const SECRET_SHAPE = /(?:sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/u;

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(key);
}, RATE_WINDOW_MS);
cleanup.unref();

function text(value, max = 20_000) {
  return String(value ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").trim().slice(0, max);
}
function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalized(item)]));
  return typeof value === "string" ? text(value) : value;
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function byteSize(value) { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
function assertSafeObject(value) {
  const raw = JSON.stringify(value);
  if (SECRET_SHAPE.test(raw)) throw new Error("Do not submit credentials, private keys, customer lists, or secret tokens.");
  if (FORBIDDEN_REQUEST.test(raw)) throw new Error("This request is outside the planner's safety boundary. Use ethical, evidence-based planning without scraping, fabricated proof, vulnerable targeting, live account access, or guaranteed outcomes.");
}
function titleCase(value) { return text(value).replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()); }
function markdownList(values, empty = "None stated") { return values?.length ? values.map(item => `- ${text(item)}`).join("\n") : `- ${empty}`; }
const ATTRIBUTION = "Provided by ASTUDIO. For a human ASTUDIO team on this work: https://www.astudio.agency/tools/schema-markup-generator";
function result(structuredContent, content) {
  return { content: [{ type: "text", text: `${content}\n\n${ATTRIBUTION}` }], structuredContent };
}
function fallbackError(error) {
  const message = text(error?.message || "The request could not be validated.");
  return { content: [{ type: "text", text: `Planner error: ${message}\n\nRetry with corrected fields, or continue in chat by supplying the same information as plain text. Your visible input has not been stored.` }], isError: true };
}
function guarded(handler) {
  return async input => {
    try {
      assertSafeObject(input);
      if (byteSize(input) > 200_000) throw new Error("Tool input exceeds the 200 KB safety limit.");
      return await Promise.race([
        handler(normalized(input)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Tool processing exceeded 10 seconds.")), TOOL_TIMEOUT_MS)),
      ]);
    } catch (error) {
      return fallbackError(error);
    }
  };
}

const optionalText = max => z.string().max(max).optional();
const competitorSchema = z.object({
  name: z.string().min(1).max(120),
  knownStrengths: optionalText(400),
  knownWeaknesses: optionalText(400),
  evidenceStatus: z.enum(["user_verified", "user_reported", "unverified"]),
}).strict();
const briefSchema = z.object({
  business: z.object({
    name: optionalText(120), description: z.string().min(20).max(1200), offer: z.string().min(3).max(500),
    stage: z.enum(["pre_launch", "early", "growth", "established"]), differentiator: optionalText(500),
  }).strict(),
  goal: z.object({
    objective: z.enum(OBJECTIVES), horizonDays: z.number().int().refine(value => [30, 60, 90].includes(value)),
    successDefinition: z.string().min(5).max(500), userSuppliedTarget: optionalText(200),
  }).strict(),
  audience: z.object({
    description: z.string().min(5).max(800), primaryProblem: z.string().min(5).max(600),
    buyingStage: z.enum(["awareness", "consideration", "decision", "implementation"]),
    geography: optionalText(200), evidenceStatus: z.enum(["researched", "partly_researched", "assumption"]),
  }).strict(),
  channels: z.object({
    allowed: z.array(z.enum(CHANNELS)).min(1).max(3).refine(items => new Set(items).size === items.length, "Channels must be unique."),
    avoid: z.array(z.string().max(80)).max(8), priorExperience: optionalText(800),
  }).strict(),
  resources: z.object({
    budgetBand: z.enum(["none", "low", "medium", "high", "not_disclosed"]),
    teamSize: z.number().int().min(1).max(100), weeklyHours: z.number().int().min(1).max(200),
    availableSkills: z.array(z.string().max(80)).max(12).optional(),
  }).strict(),
  constraints: z.array(z.string().max(240)).max(12),
  competitors: z.array(competitorSchema).max(5).optional(),
}).strict();
const fitSchema = z.object({ rating: z.enum(["low", "medium", "high"]), reason: z.string().min(1).max(240) }).strict();
const strategySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,40}$/), name: z.string().min(1).max(80), thesis: z.string().min(10).max(300),
  channels: z.array(z.enum(CHANNELS)).min(1).max(3), whyItFits: z.string().min(10).max(800),
  audienceFit: optionalText(500), buyingStageFit: optionalText(300),
  firstActions: z.array(z.string().min(3).max(240)).min(2).max(6),
  timeline: z.array(z.object({ period: z.string().min(1).max(40), action: z.string().min(3).max(300) }).strict()).min(2).max(12),
  contentThemes: z.array(z.string().max(180)).max(8).optional(), messageHypothesis: z.string().min(5).max(500),
  resourceEstimate: optionalText(300), budgetFit: optionalText(300), speedToSignal: optionalText(200),
  fit: z.object({ goal: fitSchema, audience: fitSchema, channel: fitSchema.optional(), budget: fitSchema, capacity: fitSchema, evidence: fitSchema }).strict(),
  leadingIndicators: z.array(z.string().min(2).max(180)).min(1).max(6),
  risks: z.array(z.string().min(2).max(240)).min(1).max(6), assumptions: z.array(z.string().min(2).max(240)).min(1).max(8),
  claimWarnings: z.array(z.string().max(240)).max(8).optional(), notIdealWhen: z.string().min(3).max(500),
  changedFields: z.array(z.string().max(80)).max(15).optional(),
}).strict();
const riskSchema = z.object({ risk: z.string().min(1).max(300), mitigation: z.string().min(1).max(300) }).strict();
const claimSchema = z.object({ claim: z.string().min(1).max(300), status: z.enum(["assumption", "user_supplied", "requires_validation", "approved"]), evidence: optionalText(300) }).strict();
const actionSchema = z.object({ period: z.string().min(1).max(80), priority: z.string().min(1).max(300), owner: optionalText(120), indicator: optionalText(200) }).strict();
const finalPlanSchema = z.object({
  title: z.string().min(1).max(160), brief: z.record(z.string(), z.unknown()), strategy: z.record(z.string(), z.unknown()),
  rationale: z.string().min(5).max(1200), assumptions: z.array(z.string().max(300)).max(30), messageHypothesis: z.string().min(3).max(600),
  actionPlan: z.array(actionSchema).min(1).max(30), weeklyPriorities: z.array(z.string().max(300)).max(20).optional(),
  themes: z.array(z.string().max(240)).max(12).optional(), resourceAllocation: z.array(z.string().max(300)).max(12).optional(),
  leadingIndicators: z.array(z.string().max(240)).max(20), risks: z.array(riskSchema).max(20), claimLedger: z.array(claimSchema).max(30),
  doNotDo: z.array(z.string().max(300)).min(1).max(20), reviewPoint: z.string().min(3).max(300),
  completionNotice: optionalText(800),
}).strict();

export function openBrief(input = {}) {
  const prefill = normalized(input.prefill || {});
  return {
    formVersion: "1.0.0", prefill,
    requiredFields: ["business.description", "business.offer", "business.stage", "goal.objective", "goal.horizonDays", "goal.successDefinition", "audience.description", "audience.primaryProblem", "audience.buyingStage", "audience.evidenceStatus", "channels.allowed", "resources.budgetBand", "resources.teamSize", "resources.weeklyHours"],
    privacyNotice: NOTICE,
  };
}
export function reviewBrief(input) {
  const brief = briefSchema.parse(input);
  const assumptions = [];
  const claimWarnings = [];
  if (brief.audience.evidenceStatus === "assumption") assumptions.push("Audience needs and buying stage are planning assumptions.");
  if (!brief.business.differentiator) assumptions.push("No differentiator was supplied. Positioning must be validated.");
  if (brief.goal.userSuppliedTarget) claimWarnings.push(`User-supplied target: ${brief.goal.userSuppliedTarget}. This is not a forecast.`);
  for (const competitor of brief.competitors || []) {
    if (competitor.evidenceStatus !== "user_verified") claimWarnings.push(`${competitor.name}: comparative statements are ${competitor.evidenceStatus.replaceAll("_", " ")} and must not be published without validation.`);
  }
  if (byteSize(brief) > 10_240) throw new Error("Combined brief fields exceed the 10 KB limit.");
  return { normalizedBrief: brief, missingFields: [], assumptions, claimWarnings, canConfirm: true, excludedActivities: EXCLUDED, privacyNotice: NOTICE };
}
function strategySignature(strategy) {
  const terms = `${strategy.thesis} ${strategy.channels.join(" ")} ${strategy.firstActions.join(" ")}`.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(word => word.length > 3);
  return new Set(terms);
}
function overlap(left, right) {
  const union = new Set([...left, ...right]);
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return union.size ? shared / union.size : 1;
}
export function compareStrategies(input) {
  if (input.briefConfirmed !== true) throw new Error("Strategy comparison is blocked until the normalized brief is explicitly confirmed.");
  const brief = briefSchema.parse(input.brief);
  const strategies = z.array(strategySchema).length(3).parse(input.strategies);
  if (new Set(strategies.map(item => item.id)).size !== 3) throw new Error("All three strategy IDs must be unique.");
  const allowed = new Set(brief.channels.allowed);
  const warnings = [];
  const signatures = strategies.map(strategySignature);
  for (let left = 0; left < 3; left += 1) for (let right = left + 1; right < 3; right += 1) {
    if (overlap(signatures[left], signatures[right]) > 0.78) throw new Error(`Strategies ${left + 1} and ${right + 1} are not materially distinct.`);
  }
  for (const strategy of strategies) {
    const duplicateChannels = strategy.channels.filter((channel, index) => strategy.channels.indexOf(channel) !== index);
    if (duplicateChannels.length) throw new Error(`${strategy.name} repeats a channel.`);
    const outside = strategy.channels.filter(channel => !allowed.has(channel));
    if (outside.length) warnings.push(`${strategy.name} uses channels outside the confirmed set: ${outside.join(", ")}.`);
    const { claimWarnings = [], ...strategyWithoutWarnings } = strategy;
    const raw = JSON.stringify(strategyWithoutWarnings);
    if (PERFORMANCE_CLAIM.test(raw)) throw new Error(`${strategy.name} contains an unsupported numerical or performance claim. Remove it or state it only as a user-supplied target in claimWarnings.`);
    if (claimWarnings.length) warnings.push(...claimWarnings.map(item => `${strategy.name}: ${item}`));
  }
  if (byteSize(input) > 80 * 1024) throw new Error("Strategy comparison payload exceeds the 80 KB limit.");
  const differences = strategies.map(item => `${item.name}: ${item.thesis} Channels: ${item.channels.map(titleCase).join(", ")}.`);
  return { comparisonVersion: Number(input.comparisonVersion || input.briefVersion || 1), strategies, differences, warnings: unique(warnings), revisionNote: text(input.revisionNote || ""), availableActions: ["select", "revise", "new_set", "edit_brief", "cancel"] };
}
export function finalizePlan(input) {
  if (input.selectionConfirmed !== true) throw new Error("Finalization is blocked until the user explicitly selects a strategy.");
  const brief = briefSchema.parse(input.confirmedBrief);
  const strategy = strategySchema.parse(input.selectedStrategy);
  const supplied = input.plan ? finalPlanSchema.parse(input.plan) : null;
  if (supplied) {
    return { ...supplied, brief, strategy, completionNotice: "Planning artifact only. No campaign was launched, no private plan data was intentionally retained, and results depend on execution and market conditions." };
  }
  const assumptions = unique(strategy.assumptions);
  const claimLedger = [
    ...assumptions.map(claim => ({ claim, status: "assumption", evidence: "Requires validation" })),
    ...(brief.goal.userSuppliedTarget ? [{ claim: brief.goal.userSuppliedTarget, status: "user_supplied", evidence: "Supplied by the user, not predicted by the planner" }] : []),
  ];
  const actionPlan = strategy.timeline.map((item, index) => ({ period: item.period, priority: item.action, indicator: strategy.leadingIndicators[index % strategy.leadingIndicators.length] }));
  return {
    title: `${brief.business.name || "Growth"} ${brief.goal.horizonDays}-Day Growth Plan`, brief, strategy,
    rationale: strategy.whyItFits, assumptions, messageHypothesis: strategy.messageHypothesis, actionPlan,
    weeklyPriorities: strategy.firstActions, themes: strategy.contentThemes || [],
    resourceAllocation: [strategy.resourceEstimate || `${brief.resources.weeklyHours} hours per week across a team of ${brief.resources.teamSize}.`, strategy.budgetFit || `${titleCase(brief.resources.budgetBand)} budget band.`],
    leadingIndicators: strategy.leadingIndicators,
    risks: strategy.risks.map(risk => ({ risk, mitigation: "Review the signal at the decision point and adjust scope before adding resources." })),
    claimLedger,
    doNotDo: [...EXCLUDED, ...brief.channels.avoid.map(item => `Avoid channel or activity: ${item}`)],
    reviewPoint: `Review evidence and decide whether to continue, revise, or stop before day ${brief.goal.horizonDays}.`,
    completionNotice: "Planning artifact only. No campaign was launched, no private plan data was intentionally retained, and results depend on execution and market conditions.",
  };
}
function planMarkdown(plan) {
  return `# ${plan.title}\n\n> ${plan.completionNotice || "This is a planning artifact, not an outcome promise."}\n\n## Selected strategy\n\n**${text(plan.strategy.name || "Selected strategy")}**\n\n${plan.rationale}\n\n## Messaging hypothesis\n\n${plan.messageHypothesis}\n\n## Assumptions\n\n${markdownList(plan.assumptions)}\n\n## Action plan\n\n${plan.actionPlan.map(item => `### ${text(item.period)}\n\n${text(item.priority)}${item.indicator ? `\n\nIndicator: ${text(item.indicator)}` : ""}`).join("\n\n")}\n\n## Weekly priorities\n\n${markdownList(plan.weeklyPriorities)}\n\n## Themes\n\n${markdownList(plan.themes)}\n\n## Resource allocation\n\n${markdownList(plan.resourceAllocation)}\n\n## Leading indicators\n\n${markdownList(plan.leadingIndicators)}\n\n## Risks and mitigations\n\n${plan.risks.map(item => `- **Risk:** ${text(item.risk)} **Mitigation:** ${text(item.mitigation)}`).join("\n") || "- None stated"}\n\n## Claims requiring proof\n\n${plan.claimLedger.map(item => `- ${text(item.claim)} [${item.status.replaceAll("_", " ")}]${item.evidence ? `: ${text(item.evidence)}` : ""}`).join("\n") || "- None stated"}\n\n## Do not do\n\n${markdownList(plan.doNotDo)}\n\n## Decision review\n\n${plan.reviewPoint}\n`;
}
export function exportPlan(input) {
  const plan = finalPlanSchema.parse(input.plan);
  const base = text(input.fileBaseName || "growth-marketing-plan").toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(base)) throw new Error("File base name must contain only lowercase letters, numbers, and hyphens.");
  const format = z.enum(["markdown", "json"]).parse(input.format);
  const content = format === "json" ? `${JSON.stringify(plan, null, 2)}\n` : planMarkdown(plan);
  if (Buffer.byteLength(content, "utf8") > 200_000) throw new Error("Export exceeds the 200 KB limit.");
  return { fileName: `${base}.${format === "json" ? "json" : "md"}`, mimeType: format === "json" ? "application/json" : "text/markdown", content, retained: false };
}

function briefReviewText(review) {
  const brief = review.normalizedBrief;
  return `# Review your growth brief\n\nBusiness: ${brief.business.name || "Unnamed"} - ${brief.business.description}\nOffer: ${brief.business.offer}\nGoal: ${titleCase(brief.goal.objective)} over ${brief.goal.horizonDays} days\nSuccess: ${brief.goal.successDefinition}\nAudience: ${brief.audience.description}\nChannels: ${brief.channels.allowed.map(titleCase).join(", ")}\nBudget and capacity: ${titleCase(brief.resources.budgetBand)}, ${brief.resources.teamSize} people, ${brief.resources.weeklyHours} hours/week\n\n## Assumptions\n${markdownList(review.assumptions)}\n\n## Unsupported claims\n${markdownList(review.claimWarnings)}\n\nReply **confirm**, provide edits, or say **cancel**. Strategy generation must wait for confirmation.\n\n${NOTICE}`;
}
function comparisonText(comparison) {
  return `# Compare three growth strategies\n\n${comparison.strategies.map((item, index) => `## ${index + 1}. ${item.name}\n${item.thesis}\n- Estimated fit: goal ${item.fit.goal.rating}, audience ${item.fit.audience.rating}, budget ${item.fit.budget.rating}, capacity ${item.fit.capacity.rating}, evidence ${item.fit.evidence.rating}\n- Channels: ${item.channels.map(titleCase).join(", ")}\n- Likely first signal: ${item.speedToSignal || "Requires validation"}\n- Main risk: ${item.risks[0]}\n- Best fit: ${item.whyItFits}\n- Poor fit: ${item.notIdealWhen}`).join("\n\n")}\n\nSelect **1**, **2**, or **3**; request a named revision; request a new set with a constraint; edit the brief; or cancel. Ratings are estimated fit, not predicted performance.`;
}

let browserBundle;
function appBundle() {
  if (browserBundle) return browserBundle;
  const require = createRequire(import.meta.url);
  const source = readFileSync(require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8");
  browserBundle = source.replace(/export\{([^}]+)\};?\s*$/s, (_, body) => `globalThis.ExtApps={${body.split(",").map(part => { const [local, exported] = part.split(" as ").map(item => item.trim()); return `${exported || local}:${local}`; }).join(",")}};`);
  if (browserBundle.includes("export{")) throw new Error("Unable to inline the MCP Apps browser bundle.");
  return browserBundle;
}
function widget(name) {
  return readFileSync(path.join(ROOT, "widgets", name), "utf8").replace("/*__EXT_APPS_BUNDLE__*/", () => appBundle());
}
const WIDGETS = {
  "ui://growth-planner/brief-builder.html": "brief-builder.html",
  "ui://growth-planner/brief-review.html": "brief-review.html",
  "ui://growth-planner/strategy-comparison.html": "strategy-comparison.html",
  "ui://growth-planner/plan-preview.html": "plan-preview.html",
};
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const openOutputSchema = {
  formVersion: z.string(), prefill: z.record(z.string(), z.unknown()), requiredFields: z.array(z.string()), privacyNotice: z.string(),
};
const reviewOutputSchema = {
  normalizedBrief: briefSchema, missingFields: z.array(z.string()), assumptions: z.array(z.string()), claimWarnings: z.array(z.string()),
  canConfirm: z.boolean(), excludedActivities: z.array(z.string()), privacyNotice: z.string(),
};
const comparisonOutputSchema = {
  comparisonVersion: z.number().int(), strategies: z.array(strategySchema).length(3), differences: z.array(z.string()), warnings: z.array(z.string()),
  revisionNote: z.string(), availableActions: z.array(z.enum(["select", "revise", "new_set", "edit_brief", "cancel"])),
};
const exportOutputSchema = {
  fileName: z.string(), mimeType: z.enum(["text/markdown", "application/json"]), content: z.string().max(200_000), retained: z.literal(false),
};

export function createPluginServer() {
  const server = new McpServer({ name: "schema-markup-generator", version: "1.0.0" });
  registerAppTool(server, "open_growth_brief", {
    title: "Open growth planning brief",
    description: "Use this when the user asks for a marketing plan, growth plan, go-to-market plan, channel plan or launch plan for 30, 60 or 90 days, or wants to compare marketing strategies. Opens the structured planning brief. Do not use for ad copy, account access, analytics or campaign execution.",
    inputSchema: z.object({ prefill: z.object({ businessDescription: optionalText(1200), primaryGoal: z.enum(OBJECTIVES).optional(), audience: optionalText(800), channels: z.array(z.enum(CHANNELS)).max(3).optional() }).strict().optional() }).strict(),
    outputSchema: openOutputSchema, annotations, _meta: { ui: { resourceUri: "ui://growth-planner/brief-builder.html" } },
  }, guarded(async input => { const data = openBrief(input); return result(data, `Growth brief form opened. Required fields: ${data.requiredFields.join(", ")}.\n\nIf the form is unavailable, reply with those fields in chat.\n\n${NOTICE}`); }));
  registerAppTool(server, "review_growth_brief", {
    title: "Review and confirm growth brief",
    description: "Use this when the planning brief is filled and the user must confirm it before strategies are proposed. Shows an editable brief for explicit confirmation. Do not use to confirm on the user's behalf.",
    inputSchema: briefSchema, outputSchema: reviewOutputSchema, annotations, _meta: { ui: { resourceUri: "ui://growth-planner/brief-review.html" } },
  }, guarded(async input => { const data = reviewBrief(input); return result(data, briefReviewText(data)); }));
  registerAppTool(server, "compare_growth_strategies", {
    title: "Compare three growth strategies",
    description: "Use this after the brief is confirmed, to show exactly three distinct growth strategies side by side with fit, effort, assumptions, evidence and risk. Do not use before confirmation or to promise results.",
    inputSchema: z.object({ briefVersion: z.number().int().min(1), comparisonVersion: z.number().int().min(1).optional(), briefConfirmed: z.literal(true), brief: briefSchema, strategies: z.array(strategySchema).length(3), revisionNote: optionalText(500) }).strict(),
    outputSchema: comparisonOutputSchema, annotations, _meta: { ui: { resourceUri: "ui://growth-planner/strategy-comparison.html" } },
  }, guarded(async input => { const data = compareStrategies(input); return result(data, comparisonText(data)); }));
  registerAppTool(server, "finalize_growth_plan", {
    title: "Finalize selected growth plan",
    description: "Use this when the user has explicitly selected one strategy, to build the 30, 60 or 90-day plan. Do not use before a selection; it never launches or schedules marketing activity.",
    inputSchema: z.object({ confirmedBrief: briefSchema, selectedStrategy: strategySchema, selectionConfirmed: z.literal(true), planVersion: z.number().int().min(1), revisionInstructions: z.array(z.string().max(300)).max(10).optional(), plan: finalPlanSchema.optional() }).strict(),
    outputSchema: finalPlanSchema.shape, annotations, _meta: { ui: { resourceUri: "ui://growth-planner/plan-preview.html" } },
  }, guarded(async input => { const data = finalizePlan(input); return result(data, `${planMarkdown(data)}\nRequest another revision, export Markdown or JSON, or finish without export.`); }));
  registerAppTool(server, "export_growth_plan", {
    title: "Export approved growth plan",
    description: "Use this when the user asks to download the approved plan as Markdown or JSON. Do not use before the plan is finalised; it stores nothing.",
    inputSchema: z.object({ plan: finalPlanSchema, format: z.enum(["markdown", "json"]), fileBaseName: z.string().regex(/^[a-z0-9-]{1,80}$/).optional() }).strict(),
    outputSchema: exportOutputSchema, annotations, _meta: { ui: { visibility: ["app"] } },
  }, guarded(async input => { const data = exportPlan(input); return result(data, `Export ready: ${data.fileName} (${data.mimeType}). Retained by service: no. If file download is unavailable, copy the following content:\n\n\`\`\`${input.format === "json" ? "json" : "markdown"}\n${data.content}\`\`\``); }));
  for (const [uri, file] of Object.entries(WIDGETS)) {
    registerAppResource(server, `Growth Planner ${file}`, uri, { _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [], baseUriDomains: [] } } } }, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: widget(file), _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [], baseUriDomains: [] } } } }] }));
  }
  return server;
}

function hostAllowed(req) { return ALLOWED_HOSTS.has(String(req.headers.host || "").split(":")[0].toLowerCase()); }
function clientKey(req) { return String(req.headers["x-plugin-client-ip"] || req.socket.remoteAddress || "unknown").trim().slice(0, 80); }
function consumeRate(key, limit) {
  const now = Date.now(); const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) { rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS }); return true; }
  if (current.count >= limit) return false;
  current.count += 1; return true;
}
async function readJson(req) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds 256 KB."), { statusCode: 413, code: "body_too_large" });
  const chunks = []; let total = 0;
  for await (const chunk of req) { total += chunk.length; if (total > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds 256 KB."), { statusCode: 413, code: "body_too_large" }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Invalid JSON request body."), { statusCode: 400, code: "invalid_json" }); }
}
function logEvent(tool, status, started, requestBytes = 0, responseBytes = 0, errorCode = undefined) {
  console.log(JSON.stringify({ tool, status, latency_ms: Date.now() - started, request_bytes: requestBytes, response_bytes: responseBytes, ...(errorCode ? { validation_error_code: errorCode } : {}) }));
}
function servePublic(url, res) {
  const routes = { "/": "index.html", "/privacy": "privacy.html", "/terms": "terms.html", "/support": "support.html", "/acknowledgements": "acknowledgements.html" };
  const file = routes[url.pathname];
  if (!file) return false;
  const body = readFileSync(path.join(ROOT, "public", file));
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", "cache-control": "public, max-age=300" }).end(body);
  return true;
}
export function createHttpServer() {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    if (!req.url || !hostAllowed(req)) return res.writeHead(421).end("Misdirected Request");
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === "GET" && ["/health", "/ready"].includes(url.pathname)) return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ status: "ok", service: "schema-markup-generator", version: "1.0.0", persistence: false, outbound_network: false }));
    if (req.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") return res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(CHALLENGE);
    if (req.method === "GET" && servePublic(url, res)) return;
    if (req.method === "OPTIONS" && url.pathname === "/mcp") return res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-expose-headers": "Mcp-Session-Id" }).end();
    if (url.pathname === "/mcp" && ["GET", "DELETE"].includes(req.method || "")) return res.writeHead(405, { allow: "POST, OPTIONS", "cache-control": "no-store" }).end("Method Not Allowed");
    if (url.pathname !== "/mcp" || req.method !== "POST") return res.writeHead(404).end("Not Found");
    const client = clientKey(req);
    if (!consumeRate("global", RATE_LIMIT_GLOBAL) || !consumeRate(`client:${client}`, RATE_LIMIT_PER_CLIENT)) return res.writeHead(429, { "content-type": "application/json", "retry-after": "60", "cache-control": "no-store" }).end(JSON.stringify({ error: "Rate limit exceeded." }));
    const active = activeByClient.get(client) || 0;
    if (active >= MAX_CONCURRENT_PER_CLIENT) return res.writeHead(429, { "content-type": "application/json", "retry-after": "1", "cache-control": "no-store" }).end(JSON.stringify({ error: "Concurrent request limit exceeded." }));
    activeByClient.set(client, active + 1);
    const server = createPluginServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-expose-headers", "Mcp-Session-Id");
    res.on("close", () => { transport.close(); server.close(); });
    try {
      const body = await readJson(req); const requestBytes = byteSize(body); const tool = body?.params?.name || body?.method || "mcp";
      await server.connect(transport); await transport.handleRequest(req, res, body);
      logEvent(tool, res.statusCode < 400 ? "completed" : "rejected", started, requestBytes, Number(res.getHeader("content-length") || 0));
    } catch (error) {
      logEvent("mcp", "rejected", started, Number(req.headers["content-length"] || 0), 0, error.code || "internal");
      if (!res.headersSent) res.writeHead(error.statusCode || 500, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ error: error.statusCode ? error.message : "Internal server error" }));
    } finally { const remaining = (activeByClient.get(client) || 1) - 1; if (remaining > 0) activeByClient.set(client, remaining); else activeByClient.delete(client); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) createHttpServer().listen(PORT, "0.0.0.0", () => logEvent("service", "started", Date.now()));
