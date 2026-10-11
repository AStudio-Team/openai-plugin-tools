import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { compareStrategies, createHttpServer, exportPlan, finalizePlan, openBrief, reviewBrief } from "../src/server.mjs";

export const brief = {
  business: { name: "Northstar", description: "A scheduling product for operations teams.", offer: "Monthly scheduling software", stage: "early", differentiator: "Fast setup for small operations teams" },
  goal: { objective: "qualified_leads", horizonDays: 60, successDefinition: "Learn which message produces qualified conversations", userSuppliedTarget: "Ten qualified conversations" },
  audience: { description: "Operations leads at small service businesses", primaryProblem: "Scheduling work takes too much manual coordination", buyingStage: "consideration", geography: "United Arab Emirates", evidenceStatus: "partly_researched" },
  channels: { allowed: ["content", "email", "partnerships"], avoid: ["paid social"], priorExperience: "Founder posts drew a few conversations" },
  resources: { budgetBand: "low", teamSize: 2, weeklyHours: 6, availableSkills: ["writing", "customer interviews"] },
  constraints: ["No paid media", "No unsolicited bulk outreach"],
  competitors: [{ name: "Calendar Co", knownStrengths: "User reports a broad feature set", knownWeaknesses: "Setup may feel complex", evidenceStatus: "user_reported" }],
};

function fit(rating, reason) { return { rating, reason }; }
export const strategies = [
  {
    id: "problem-led-content", name: "Problem-led content", thesis: "Build searchable decision content around the audience's manual scheduling pain.", channels: ["content", "email"],
    whyItFits: "Uses the team's writing skill and existing conversations to develop useful content.", audienceFit: "Addresses operations leads already considering a solution.", buyingStageFit: "Supports consideration.",
    firstActions: ["Interview three recent prospects about scheduling friction", "Publish one decision guide and invite direct replies"],
    timeline: [{ period: "Weeks 1-2", action: "Capture audience language and publish the first decision guide" }, { period: "Weeks 3-4", action: "Distribute the guide to opted-in contacts and collect questions" }, { period: "Weeks 5-8", action: "Expand the strongest topic and review qualified conversations" }],
    contentThemes: ["Manual scheduling cost", "Implementation questions"], messageHypothesis: "Reduce coordination friction without adding another complex operating system.",
    resourceEstimate: "Four writing hours and two interview hours each week.", budgetFit: "Low cash requirement.", speedToSignal: "Replies and interview requests within the first publishing cycle.",
    fit: { goal: fit("high", "Can generate qualified conversations."), audience: fit("high", "Uses known pain."), channel: fit("high", "Uses confirmed channels."), budget: fit("high", "Low cash requirement."), capacity: fit("medium", "Needs consistent writing."), evidence: fit("medium", "Audience evidence is partial.") },
    leadingIndicators: ["Qualified replies", "Decision guide completions"], risks: ["Publishing cadence may exceed available time"], assumptions: ["The audience searches for implementation guidance"], claimWarnings: [], notIdealWhen: "The team cannot sustain writing or audience interviews."
  },
  {
    id: "partner-referrals", name: "Partner referral loop", thesis: "Earn introductions through service partners who already advise the intended buyer.", channels: ["partnerships", "email"],
    whyItFits: "Concentrates scarce time on a small number of trusted distribution relationships.", audienceFit: "Reaches buyers through advisers they already use.", buyingStageFit: "Supports consideration and decision.",
    firstActions: ["List ten adjacent service partners from existing knowledge", "Draft a mutual-value introduction and ask for five conversations"],
    timeline: [{ period: "Weeks 1-2", action: "Validate partner value and hold exploratory conversations" }, { period: "Weeks 3-4", action: "Pilot one co-created referral resource" }, { period: "Weeks 5-8", action: "Review introduction quality and continue only validated relationships" }],
    contentThemes: ["Referral readiness", "Shared customer workflow"], messageHypothesis: "Help shared clients simplify scheduling handoffs with a clear implementation path.",
    resourceEstimate: "Three relationship hours and three enablement hours weekly.", budgetFit: "No paid placement assumed.", speedToSignal: "Partner conversations before referred demand.",
    fit: { goal: fit("high", "Introductions may create qualified conversations."), audience: fit("medium", "Partner access is unverified."), channel: fit("high", "Partnerships are confirmed."), budget: fit("high", "No media spend."), capacity: fit("high", "Small relationship set."), evidence: fit("low", "Partner willingness is an assumption.") },
    leadingIndicators: ["Partner conversations", "Qualified introductions"], risks: ["Partners may not see mutual value"], assumptions: ["Relevant advisers will accept exploratory conversations"], claimWarnings: [], notIdealWhen: "No credible partner category or mutual value can be identified."
  },
  {
    id: "customer-evidence", name: "Customer evidence sprint", thesis: "Turn direct prospect learning into focused proof and sales enablement before expanding distribution.", channels: ["email", "content"],
    whyItFits: "Prioritizes message evidence before broader acquisition activity.", audienceFit: "Uses the language of current prospects and customers.", buyingStageFit: "Supports decision and implementation concerns.",
    firstActions: ["Ask opted-in users for five learning interviews", "Create a proof ledger separating verified facts from assumptions"],
    timeline: [{ period: "Weeks 1-2", action: "Collect and code recurring objections without fabricating quotes" }, { period: "Weeks 3-4", action: "Rewrite core messages around verified concerns" }, { period: "Weeks 5-8", action: "Test revised messages in opted-in follow-up and review conversation quality" }],
    contentThemes: ["Implementation confidence", "Verified buyer objections"], messageHypothesis: "A straightforward setup can reduce manual coordination for teams that validate the fit.",
    resourceEstimate: "Four research hours and two editing hours weekly.", budgetFit: "Uses existing opted-in relationships.", speedToSignal: "Repeated objections and message responses after interviews.",
    fit: { goal: fit("medium", "Improves qualification before scale."), audience: fit("high", "Direct audience learning."), channel: fit("high", "Uses email and content."), budget: fit("high", "No paid media."), capacity: fit("medium", "Interviews require scheduling."), evidence: fit("high", "Designed to strengthen evidence.") },
    leadingIndicators: ["Completed interviews", "Repeated objections", "Qualified follow-up replies"], risks: ["Interview sample may be too narrow"], assumptions: ["Opted-in users will participate"], claimWarnings: [], notIdealWhen: "There is no reachable set of opted-in users or prospects."
  }
];

async function listen(server) { await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return server.address().port; }
async function rpc(port, method, params, id = 1) { return fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) }); }

test("brief opening exposes required fields and privacy notice", () => {
  const opened = openBrief({ prefill: { businessDescription: "A sufficiently described scheduling product" } });
  assert.equal(opened.prefill.businessDescription.includes("scheduling"), true);
  assert.ok(opened.requiredFields.includes("goal.objective"));
  assert.match(opened.privacyNotice, /does not connect/);
});

test("review normalizes complete input and flags assumptions and competitor evidence", () => {
  const input = structuredClone(brief); input.audience.evidenceStatus = "assumption"; delete input.business.differentiator;
  const review = reviewBrief(input);
  assert.equal(review.canConfirm, true);
  assert.ok(review.assumptions.length >= 2);
  assert.ok(review.claimWarnings.some(item => item.includes("Calendar Co")));
  assert.ok(review.excludedActivities.includes("Scraping or live market research"));
});

test("review rejects unknown properties and oversized briefs", () => {
  assert.throws(() => reviewBrief({ ...brief, secretExtra: true }));
  const large = structuredClone(brief); large.constraints = Array.from({ length: 12 }, (_, i) => `${i} ${"x".repeat(230)}`); large.channels.priorExperience = "y".repeat(790); large.business.description = "z".repeat(1190); large.business.offer = "o".repeat(490); large.audience.description = "a".repeat(790); large.audience.primaryProblem = "p".repeat(590); large.competitors = Array.from({ length: 5 }, (_, index) => ({ name: `Competitor ${index}`, knownStrengths: "s".repeat(390), knownWeaknesses: "w".repeat(390), evidenceStatus: "unverified" }));
  assert.throws(() => reviewBrief(large), /10 KB/);
});

test("comparison requires confirmed brief and exactly three unique strategies", () => {
  assert.throws(() => compareStrategies({ briefVersion: 1, briefConfirmed: false, brief, strategies }), /blocked/);
  assert.throws(() => compareStrategies({ briefVersion: 1, briefConfirmed: true, brief, strategies: strategies.slice(0, 2) }));
  const duplicate = structuredClone(strategies); duplicate[2].id = duplicate[1].id;
  assert.throws(() => compareStrategies({ briefVersion: 1, briefConfirmed: true, brief, strategies: duplicate }), /unique/);
});

test("comparison rejects title-only variations and unsupported performance claims", () => {
  const same = [0, 1, 2].map(index => ({ ...structuredClone(strategies[0]), id: `same-${index}`, name: `Name ${index}` }));
  assert.throws(() => compareStrategies({ briefVersion: 1, briefConfirmed: true, brief, strategies: same }), /materially distinct/);
  const claims = structuredClone(strategies); claims[0].thesis = "This channel will increase revenue by 25% for every team.";
  assert.throws(() => compareStrategies({ briefVersion: 1, briefConfirmed: true, brief, strategies: claims }), /unsupported/);
});

test("comparison returns exactly three options, neutral ratings and revision visibility", () => {
  const revised = structuredClone(strategies); revised[1].changedFields = ["channels", "resourceEstimate"];
  const compared = compareStrategies({ briefVersion: 1, comparisonVersion: 2, briefConfirmed: true, brief, strategies: revised, revisionNote: "Reduced founder time." });
  assert.equal(compared.strategies.length, 3);
  assert.equal(compared.comparisonVersion, 2);
  assert.deepEqual(compared.strategies[1].changedFields, ["channels", "resourceEstimate"]);
  assert.deepEqual(compared.availableActions, ["select", "revise", "new_set", "edit_brief", "cancel"]);
});

test("finalization requires explicit selection and contains all planning sections", () => {
  assert.throws(() => finalizePlan({ confirmedBrief: brief, selectedStrategy: strategies[0], selectionConfirmed: false, planVersion: 1 }), /blocked/);
  const plan = finalizePlan({ confirmedBrief: brief, selectedStrategy: strategies[0], selectionConfirmed: true, planVersion: 1 });
  for (const key of ["brief", "strategy", "rationale", "assumptions", "messageHypothesis", "actionPlan", "weeklyPriorities", "themes", "resourceAllocation", "leadingIndicators", "risks", "claimLedger", "doNotDo", "reviewPoint"]) assert.ok(key in plan, key);
  assert.match(plan.completionNotice, /No campaign was launched/);
  assert.ok(plan.claimLedger.some(item => item.status === "user_supplied"));
});

test("Markdown and JSON exports round-trip without retention", () => {
  const plan = finalizePlan({ confirmedBrief: brief, selectedStrategy: strategies[0], selectionConfirmed: true, planVersion: 1 });
  const markdown = exportPlan({ plan, format: "markdown", fileBaseName: "northstar-growth-plan" });
  assert.equal(markdown.fileName, "northstar-growth-plan.md"); assert.equal(markdown.retained, false); assert.match(markdown.content, /# Northstar 60-Day Growth Plan/); assert.match(markdown.content, /## Do not do/);
  const json = exportPlan({ plan, format: "json", fileBaseName: "northstar-growth-plan" });
  assert.deepEqual(JSON.parse(json.content), plan); assert.equal(json.mimeType, "application/json");
  assert.throws(() => exportPlan({ plan, format: "json", fileBaseName: "Bad Name" }));
});

test("HTTP service exposes health, challenge, public pages, and blocks wrong host", async context => {
  const server = createHttpServer(); const port = await listen(server); context.after(() => new Promise(resolve => server.close(resolve)));
  const health = await fetch(`http://127.0.0.1:${port}/health`); assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: "ok", service: "launch-plan-builder", version: "1.0.0", persistence: false, outbound_network: false });
  const challenge = await fetch(`http://127.0.0.1:${port}/.well-known/openai-apps-challenge`); assert.equal(await challenge.text(), "configure-before-production");
  for (const route of ["/", "/privacy", "/terms", "/support", "/acknowledgements"]) assert.equal((await fetch(`http://127.0.0.1:${port}${route}`)).status, 200);
  const wrongHost = await new Promise((resolve, reject) => { const request = http.request({ hostname: "127.0.0.1", port, path: "/health", headers: { host: "attacker.example" } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); }); request.on("error", reject); request.end(); }); assert.equal(wrongHost, 421);
});

test("MCP lists five strict read-only, closed-world tools with widget metadata", async context => {
  const server = createHttpServer(); const port = await listen(server); context.after(() => new Promise(resolve => server.close(resolve)));
  const response = await rpc(port, "tools/list"); assert.equal(response.status, 200); const body = await response.json();
  assert.deepEqual(body.result.tools.map(item => item.name), ["open_growth_brief", "review_growth_brief", "compare_growth_strategies", "finalize_growth_plan", "export_growth_plan"]);
  for (const tool of body.result.tools) { assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.destructiveHint, false); assert.equal(tool.annotations.openWorldHint, false); assert.equal(tool.inputSchema.additionalProperties, false); assert.equal(tool.outputSchema.type, "object"); }
  assert.equal(body.result.tools[0]._meta.ui.resourceUri, "ui://growth-planner/brief-builder.html");
});

test("MCP resources are separate, closed-CSP widgets with inlined official runtime", async context => {
  const server = createHttpServer(); const port = await listen(server); context.after(() => new Promise(resolve => server.close(resolve)));
  const listed = await (await rpc(port, "resources/list")).json(); assert.equal(listed.result.resources.length, 4);
  for (const resource of listed.result.resources) {
    const read = await (await rpc(port, "resources/read", { uri: resource.uri })).json(); const item = read.result.contents[0];
    assert.equal(item.mimeType, "text/html;profile=mcp-app"); assert.equal(item._meta.ui.prefersBorder, false); assert.deepEqual(item._meta.ui.csp.connectDomains, []);
    assert.ok(!item.text.includes("/*__EXT_APPS_BUNDLE__*/")); assert.ok(item.text.includes("sendMessage")); assert.ok(!/<script[^>]+src=|url\(https?:/i.test(item.text)); assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(item.text));
  }
});

test("MCP text fallback remains useful and checkpoint errors are visible", async context => {
  const server = createHttpServer(); const port = await listen(server); context.after(() => new Promise(resolve => server.close(resolve)));
  const opened = await (await rpc(port, "tools/call", { name: "open_growth_brief", arguments: {} })).json(); assert.match(opened.result.content[0].text, /If the form is unavailable/); assert.ok(opened.result.structuredContent.requiredFields.length > 5);
  const blocked = await (await rpc(port, "tools/call", { name: "compare_growth_strategies", arguments: { briefVersion: 1, briefConfirmed: false, brief, strategies } })).json(); assert.equal(blocked.result.isError, true);
});

test("MCP rejects unsafe requests without exposing submitted content in logs", async context => {
  const server = createHttpServer(); const port = await listen(server); context.after(() => new Promise(resolve => server.close(resolve)));
  const logs = []; const original = console.log; console.log = value => logs.push(String(value));
  try {
    const payload = structuredClone(brief); payload.business.description = "Target vulnerable elderly users and invent testimonials for trust.";
    const response = await (await rpc(port, "tools/call", { name: "review_growth_brief", arguments: payload })).json(); assert.equal(response.result.isError, true); assert.match(response.result.content[0].text, /ethical/);
  } finally { console.log = original; }
  assert.equal(logs.some(line => line.includes("vulnerable elderly")), false); assert.ok(logs.every(line => !line.includes("Northstar")));
});

test("body limit and stateless HTTP methods are enforced", async context => {
  const server = createHttpServer(); const port = await listen(server); context.after(() => new Promise(resolve => server.close(resolve)));
  for (const method of ["GET", "DELETE"]) { const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method }); assert.equal(response.status, 405); }
  const oversizedStatus = await new Promise((resolve, reject) => { const request = http.request({ hostname: "127.0.0.1", port, path: "/mcp", method: "POST", headers: { "content-type": "application/json", "content-length": String(256 * 1024 + 1) } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); }); request.on("error", reject); request.end(); }); assert.equal(oversizedStatus, 413);
});
