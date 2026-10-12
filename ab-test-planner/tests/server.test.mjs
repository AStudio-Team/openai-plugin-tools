import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { approveTestBrief, createHttpServer, planAbTest, sampleSize, validatePlan } from "../src/server.mjs";

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
  assert.equal(issues.length,4);
});

async function post(base,name,args,id=1){const response=await fetch(`${base}/mcp`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id,method:"tools/call",params:{name,arguments:args}})});return(await response.json()).result}
async function fixture(t){const server=createHttpServer().listen(0,"127.0.0.1");await once(server,"listening");t.after(()=>server.close());return`http://127.0.0.1:${server.address().port}`}
class Element{constructor(tag="div"){this.tag=tag;this.children=[];this.textContent="";this.value="";this.disabled=false;this.hidden=false;this.dataset={}}append(...items){this.children.push(...items)}replaceChildren(...items){this.children=[...items]}}
function widgetDocument(){const nodes=new Map,created=[];return{created,querySelector(selector){if(!nodes.has(selector))nodes.set(selector,new Element);return nodes.get(selector)},createElement(tag){const node=new Element(tag);created.push(node);return node}}}
class WidgetFormData{constructor(form){this.values=form.children.filter(x=>x.name).map(x=>[x.name,x.value])}[Symbol.iterator](){return this.values[Symbol.iterator]()}}
async function runWidget(file,app,document){const html=readFileSync(fileURLToPath(new URL(`../widgets/${file}`,import.meta.url)),"utf8"),script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;await new AsyncFunction("globalThis","document","FormData","navigator",script)({ExtApps:{App:class{constructor(){return app}}}},document,WidgetFormData,{clipboard:{writeText:async()=>{}}})}

test("widget payloads pass strict schemas over the real HTTP server",async t=>{const base=await fixture(t);let id=10,reviewArgs,exportArgs;const call=async(name,args)=>{const result=await post(base,name,args,id++);assert.notEqual(result.isError,true,result.content?.[0]?.text);return result};const builderDocument=widgetDocument(),builderApp={async connect(){await this.ontoolresult({structuredContent:{prefill:brief}})},async callServerTool({name,arguments:args}){reviewArgs=args;return call(name,args)},async sendMessage(){}};await runWidget("brief-builder.html",builderApp,builderDocument);await builderDocument.querySelector("#form").onsubmit({preventDefault(){}});assert.deepEqual(Object.keys(reviewArgs).sort(),Object.keys(brief).sort());const approved=await call("approve_test_brief",{brief,approvalAction:"approve"}),planned=await call("plan_ab_test",{brief,approvalReceipt:approved.structuredContent.approvalReceipt,plan});const planDocument=widgetDocument(),planApp={async connect(){await this.ontoolresult({structuredContent:planned.structuredContent})},async callServerTool({name,arguments:args}){exportArgs=args;return call(name,args)},async sendMessage(){},async downloadFile(){}};await runWidget("plan-options.html",planApp,planDocument);await planDocument.querySelector("#export").onclick({target:planDocument.querySelector("#export")});assert.deepEqual(Object.keys(exportArgs).sort(),["approvalReceipt","brief","format","plan"]);assert.match(planDocument.querySelector("#file").textContent,/A\/B Test Plan/)});
