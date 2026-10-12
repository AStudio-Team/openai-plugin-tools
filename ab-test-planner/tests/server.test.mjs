import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { approveTestBrief, createHttpServer, exportTestPlan, planAbTest, reviewTestBrief, sampleSize, validatePlan } from "../src/server.mjs";

const brief={pageOrFeature:"Pricing page",changeIdea:"Show annual saving beside price",primaryMetric:"trial_started",baselineConversionRate:5,weeklyVisitors:4000,minimumDetectableEffect:20,variants:2,confidence:95,power:80};
const plan={hypothesis:"Because visitors do not see the annual saving, we believe showing the annual saving will increase trials measured by trial_started.",primaryMetric:"trial_started",guardrailMetrics:["checkout_error_rate"],variants:[{name:"Control",change:"Keep current price display"},{name:"Variant",change:"Show annual saving beside price"}],events:[{name:"trial_started",properties:["variant"]}],preLaunchChecklist:["Verify event firing on both variants"],stopRule:"Do not stop early when peeking; wait for the planned sample size."};

test("pooled two-proportion calculation is near the known 5% / 20% lift value",()=>{
  const result=sampleSize(brief);
  assert.ok(result.perVariant>8000&&result.perVariant<8300,result.perVariant);
  assert.equal(result.weeks,Math.ceil(result.total/brief.weeklyVisitors));
});

test("planning requires a signed widget approval receipt",()=>{
  assert.throws(()=>planAbTest({brief,plan}),/approvalReceipt/);
  const approvalReceipt=approveTestBrief({brief,approvalAction:"approve"}).approvalReceipt;
  const result=planAbTest({brief,approvalReceipt,plan});
  assert.equal(result.validation.valid,true);
  assert.equal(result.sampleSize.perVariant,sampleSize(brief).perVariant);
});

test("impossible rates and zero traffic are rejected",()=>{
  for(const change of [{baselineConversionRate:0},{baselineConversionRate:100},{weeklyVisitors:0}])assert.throws(()=>approveTestBrief({brief:{...brief,...change},approvalAction:"approve"}));
});

test("plan validation accepts the required experiment safeguards",()=>{
  assert.equal(validatePlan(brief,plan).valid,true);
});

test("plan validation reports each missing experiment safeguard",()=>{
  const invalid={...plan,hypothesis:"Show the annual saving.",primaryMetric:"purchase_completed",guardrailMetrics:[],variants:[...plan.variants.slice(0,1),{name:"Variant",change:"Show saving and add testimonials"}],events:[{name:"TrialStarted",properties:["variant"]}],preLaunchChecklist:[],stopRule:"Review results every day."};
  assert.throws(()=>validatePlan(brief,invalid));
  const issues=validatePlan(brief,{...plan,hypothesis:"Show the annual saving.",primaryMetric:"purchase_completed",variants:[...plan.variants.slice(0,1),{name:"Variant",change:"Show saving and add testimonials"}],stopRule:"Review results every day."}).issues;
  assert.deepEqual(new Set(issues.map(x=>x.code)),new Set(["unsupported_claim","hypothesis_format","primary_metric","multiple_changes","stop_rule"]));
});

test("each plan rule has a failing and passing case",()=>{
  assert.equal(validatePlan(brief,plan).issues.length,0);
  const cases=[
    [{hypothesis:"Try a saving message."},"hypothesis_format"],
    [{primaryMetric:"purchase_completed"},"primary_metric"],
    [{variants:[...plan.variants,{name:"Third",change:"Use a blue button"}]},"variant_count"],
    [{variants:[plan.variants[0],{name:"Variant",change:"Change headline and button"}]},"multiple_changes"],
    [{stopRule:"Check every morning and declare a winner."},"stop_rule"],
  ];
  for(const [change,code] of cases)assert.ok(validatePlan(brief,{...plan,...change}).issues.some(x=>x.code===code),code);
  assert.throws(()=>validatePlan(brief,{...plan,guardrailMetrics:[]}));
  assert.throws(()=>validatePlan(brief,{...plan,events:[{name:"TrialStarted",properties:["variant"]}]}));
  assert.throws(()=>validatePlan(brief,{...plan,events:[{name:"trial_started",properties:[]}]}));
  assert.throws(()=>validatePlan(brief,{...plan,preLaunchChecklist:[]}));
});

test("banned and unsupported claims are rejected in brief and every plan text field",()=>{
  const banned={...brief,changeIdea:"Guaranteed 200 percent growth"};
  assert.equal(reviewTestBrief(banned).canApprove,false);
  assert.equal(reviewTestBrief(brief).canApprove,true);
  for(const change of [
    {hypothesis:"Because visitors hesitate, we believe a 30% lift will happen measured by trial_started."},
    {guardrailMetrics:["Trusted by 500 teams"]},
    {variants:[plan.variants[0],{name:"Variant",change:"Rated five-star by customers"}]},
    {events:[{name:"trial_started",properties:["98% success"]}]},
    {preLaunchChecklist:["Guarantee conversion before launch"]},
    {stopRule:"Never stop early when peeking; guaranteed winner."},
  ]) assert.ok(validatePlan(brief,{...plan,...change}).issues.some(x=>["banned_claim","unsupported_claim"].includes(x.code)));
  const sourcedBrief={...brief,suppliedFacts:["Serving 500 teams"]};
  const sourced={...plan,guardrailMetrics:["Serving 500 teams"]};
  assert.equal(validatePlan(sourcedBrief,sourced).valid,true);
  assert.ok(validatePlan({...brief,suppliedFacts:["Serving 400 teams"]},sourced).issues.some(x=>x.code==="unsupported_claim"));
});

async function post(base,name,args,id=1){const response=await fetch(`${base}/mcp`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id,method:"tools/call",params:{name,arguments:args}})});return(await response.json()).result}
async function rpc(base,body){const response=await fetch(`${base}/mcp`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify(body)});return {response,body:await response.json()}}
async function fixture(t){const server=createHttpServer().listen(0,"127.0.0.1");await once(server,"listening");t.after(()=>server.close());return`http://127.0.0.1:${server.address().port}`}
class Element{constructor(tag="div"){this.tag=tag;this.children=[];this.textContent="";this.value="";this.disabled=false;this.hidden=false;this.dataset={}}append(...items){this.children.push(...items)}replaceChildren(...items){this.children=[...items]}}
function widgetDocument(){const nodes=new Map,created=[];return{created,querySelector(selector){if(!nodes.has(selector))nodes.set(selector,new Element);return nodes.get(selector)},createElement(tag){const node=new Element(tag);created.push(node);return node}}}
class WidgetFormData{constructor(form){this.values=form.children.filter(x=>x.name).map(x=>[x.name,x.value])}[Symbol.iterator](){return this.values[Symbol.iterator]()}}
async function runWidget(file,app,document){const html=readFileSync(fileURLToPath(new URL(`../widgets/${file}`,import.meta.url)),"utf8"),script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;await new AsyncFunction("globalThis","document","FormData","navigator",script)({ExtApps:{App:class{constructor(){return app}}}},document,WidgetFormData,{clipboard:{writeText:async()=>{}}})}

test("widget payloads pass strict schemas over the real HTTP server",async t=>{const base=await fixture(t);let id=10,reviewArgs,exportArgs;const call=async(name,args)=>{const result=await post(base,name,args,id++);assert.notEqual(result.isError,true,result.content?.[0]?.text);return result};const builderDocument=widgetDocument(),builderApp={async connect(){await this.ontoolresult({structuredContent:{prefill:brief}})},async callServerTool({name,arguments:args}){reviewArgs=args;return call(name,args)},async sendMessage(){}};await runWidget("brief-builder.html",builderApp,builderDocument);await builderDocument.querySelector("#form").onsubmit({preventDefault(){}});assert.deepEqual(Object.keys(reviewArgs).sort(),[...Object.keys(brief),"proofPoints","suppliedFacts"].sort());const approved=await call("approve_test_brief",{brief,approvalAction:"approve"}),planned=await call("plan_ab_test",{brief,approvalReceipt:approved.structuredContent.approvalReceipt,plan});const planDocument=widgetDocument(),planApp={async connect(){await this.ontoolresult({structuredContent:planned.structuredContent})},async callServerTool({name,arguments:args}){exportArgs=args;return call(name,args)},async sendMessage(){},async downloadFile(){}};await runWidget("plan-options.html",planApp,planDocument);await planDocument.querySelector("#export").onclick({target:planDocument.querySelector("#export")});assert.deepEqual(Object.keys(exportArgs).sort(),["approvalReceipt","brief","format","plan"]);assert.match(planDocument.querySelector("#file").textContent,/A\/B Test Plan/)});

test("MCP inventory exposes exact contract metadata and a conforming real result",async t=>{const base=await fixture(t);await rpc(base,{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"test",version:"1"}}});const tools=(await rpc(base,{jsonrpc:"2.0",id:2,method:"tools/list"})).body.result.tools;assert.deepEqual(tools.map(x=>x.name),["open_test_brief","review_test_brief","approve_test_brief","plan_ab_test","request_test_revision","export_test_plan"]);for(const tool of tools){assert.match(tool.description,/^Use this when .*Do not use for /);assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});assert.equal(tool.outputSchema.additionalProperties,false)}assert.deepEqual(tools.find(x=>x.name==="approve_test_brief")._meta.ui.visibility,["app"]);const result=await post(base,"open_test_brief",{},3);assert.deepEqual(Object.keys(result.structuredContent).sort(),["fields","prefill","privacyNotice"])});

test("widget resources are bundled IIFEs with closed CSP",async t=>{const base=await fixture(t);await rpc(base,{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"test",version:"1"}}});const resources=(await rpc(base,{jsonrpc:"2.0",id:2,method:"resources/list"})).body.result.resources;assert.equal(resources.length,4);for(const [index,resource] of resources.entries()){const item=(await rpc(base,{jsonrpc:"2.0",id:10+index,method:"resources/read",params:{uri:resource.uri}})).body.result.contents[0];assert.equal(item.mimeType,"text/html;profile=mcp-app");assert.doesNotMatch(item.text,/__EXT_APPS_BUNDLE__/);assert.match(item.text,/\(\(\)=>\{/);const scripts=[...item.text.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(x=>x[1]);assert.equal(scripts.length,1);Object.getPrototypeOf(async function(){}).constructor(scripts[0]);assert.deepEqual(item._meta.ui.csp,{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]})}});

test("receipts gate planning and export and reject forgery",()=>{assert.throws(()=>planAbTest({brief,plan}),/approvalReceipt/);assert.throws(()=>exportTestPlan({brief,plan,format:"markdown"}),/approvalReceipt/);const receipt=approveTestBrief({brief,approvalAction:"approve"}).approvalReceipt;assert.throws(()=>planAbTest({brief,plan,approvalReceipt:{...receipt,signature:"f".repeat(64)}}),/receipt/i);const out=exportTestPlan({brief,plan,approvalReceipt:receipt,format:"markdown"});assert.equal(out.fileName,"ab-test-plan.md");assert.match(out.content,/A\/B Test Plan/)});

test("invalid SDK calls for every tool retain attribution",async t=>{const base=await fixture(t);for(const [index,name] of ["open_test_brief","review_test_brief","approve_test_brief","plan_ab_test","request_test_revision","export_test_plan"].entries()){const result=await post(base,name,{unexpected:true},20+index);assert.equal(result.isError,true,name);assert.match(result.content.filter(x=>x.type==="text").at(-1).text,/Provided by ASTUDIO[\s\S]*ab-test-planner$/,name)}});

test("CSV export neutralises spreadsheet formula cells",()=>{const riskyBrief={...brief,suppliedFacts:["-1"]},receipt=approveTestBrief({brief:riskyBrief,approvalAction:"approve"}).approvalReceipt;const risky={...plan,events:[["trial_started","=cmd"],["page_viewed","+sum"],["form_submitted","-1"],["button_clicked","@user"]].map(([name,property])=>({name,properties:[property]}))};const out=exportTestPlan({brief:riskyBrief,plan:risky,approvalReceipt:receipt,format:"csv"});for(const value of ["'=cmd","'+sum","'-1","'@user"])assert.ok(out.content.includes(value),value)});

test("health, malformed JSON, and aborted requests are contained",async t=>{const base=await fixture(t);for(const route of ["health","ready"]){const response=await fetch(`${base}/${route}`);assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");assert.deepEqual(await response.json(),{status:"ok",service:"ab-test-planner",version:"1.0.1",persistence:false,outbound_network:false})}const malformed=await fetch(`${base}/mcp`,{method:"POST",headers:{"content-type":"application/json"},body:"{"});assert.equal(malformed.status,400);const {request}=await import("node:http");await new Promise(resolve=>{const req=request(`${base}/mcp`,{method:"POST",headers:{"content-type":"application/json"}});req.on("error",()=>resolve());req.write('{"jsonrpc":');req.destroy();setImmediate(resolve)});assert.equal((await fetch(`${base}/health`)).status,200)});
