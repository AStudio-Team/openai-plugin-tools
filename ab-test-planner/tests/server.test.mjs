import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { approveTestBrief, createHttpServer, exportTestPlan, planAbTest, reviewTestBrief, sampleSize, validatePlan } from "../src/server.mjs";

const brief={pageOrFeature:"Pricing page",changeIdea:"Show annual saving beside price",primaryMetric:"trial_started",baselineConversionRate:5,weeklyVisitors:4000,minimumDetectableEffect:20,variants:2,confidence:95,power:80};
const plan={hypothesis:{because:"visitors do not see the annual saving",weBelieve:"showing the annual saving",willCause:"increase trials",measuredBy:"trial_started"},primaryMetric:"trial_started",guardrailMetrics:["checkout_error_rate"],variants:[{name:"Control",change:"Keep current price display"},{name:"Variant",change:"Show annual saving beside price"}],events:[{name:"trial_started",properties:["variant"]}],preLaunchChecklist:["Verify event firing on both variants","Verify allocation","Verify guardrail dashboard"],stopRule:{basis:"sample_size",value:8158}};

test("pooled two-proportion calculation is near the known 5% / 20% lift value",()=>{
  const result=sampleSize(brief);
  const p1=.05,p2=.06,pooled=(p1+p2)/2,expected=Math.ceil(((1.959963985*Math.sqrt(2*pooled*(1-pooled))+.841621234*Math.sqrt(p1*(1-p1)+p2*(1-p2)))**2)/((p2-p1)**2));
  assert.equal(result.perVariant,expected);
  assert.equal(result.perVariant,8158);
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
  const invalid={...plan,hypothesis:{...plan.hypothesis,because:""},primaryMetric:"purchase_completed",guardrailMetrics:[],variants:[...plan.variants.slice(0,1),{name:"Variant",change:"Show saving and add testimonials"}],events:[{name:"TrialStarted",properties:[]}],preLaunchChecklist:[],stopRule:{basis:"duration",value:99}};
  assert.deepEqual(new Set(validatePlan(brief,invalid).issues.map(x=>x.code)),new Set(["blank","unsupported_claim","hypothesis_format","primary_metric","guardrail_metric","multiple_changes","event_name","event_properties","prelaunch_checklist","stop_rule"]));
  const issues=validatePlan(brief,{...plan,hypothesis:{...plan.hypothesis,because:""},primaryMetric:"purchase_completed",variants:[...plan.variants.slice(0,1),{name:"Variant",change:"Show saving and add testimonials"}],stopRule:{basis:"duration",value:99}}).issues;
  assert.deepEqual(new Set(issues.map(x=>x.code)),new Set(["blank","unsupported_claim","hypothesis_format","primary_metric","multiple_changes","stop_rule"]));
});

test("each plan rule has a failing and passing case",()=>{
  assert.equal(validatePlan(brief,plan).issues.length,0);
  const cases=[
    [{hypothesis:{...plan.hypothesis,measuredBy:"purchase_completed"}},"hypothesis_format"],
    [{primaryMetric:"purchase_completed"},"primary_metric"],
    [{variants:[...plan.variants,{name:"Third",change:"Use a blue button"}]},"variant_count"],
    [{variants:[plan.variants[0],{name:"Variant",change:"Change headline and button"}]},"multiple_changes"],
    [{stopRule:{basis:"duration",value:99}},"stop_rule"],
  ];
  for(const [change,code] of cases)assert.ok(validatePlan(brief,{...plan,...change}).issues.some(x=>x.code===code),code);
  assert.ok(validatePlan(brief,{...plan,guardrailMetrics:[]}).issues.some(x=>x.code==="guardrail_metric"));
  assert.ok(validatePlan(brief,{...plan,events:[{name:"TrialStarted",properties:["variant"]}]}).issues.some(x=>x.code==="event_name"));
  assert.ok(validatePlan(brief,{...plan,events:[{name:"trial_started",properties:[]}] }).issues.some(x=>x.code==="event_properties"));
  assert.ok(validatePlan(brief,{...plan,events:[{name:"trial_started"}]}).issues.some(x=>x.code==="event_properties"));
  assert.ok(validatePlan(brief,{...plan,preLaunchChecklist:[]}).issues.some(x=>x.code==="prelaunch_checklist"));
});

test("banned and unsupported claims are rejected in brief and every plan text field",()=>{
  const banned={...brief,changeIdea:"Guaranteed 200 percent growth"};
  assert.equal(reviewTestBrief(banned).canApprove,false);
  assert.equal(reviewTestBrief(brief).canApprove,true);
  for(const change of [
    {hypothesis:{...plan.hypothesis,willCause:"a 30% lift"}},
    {guardrailMetrics:["Trusted by 500 teams"]},
    {variants:[plan.variants[0],{name:"Variant",change:"Rated five-star by customers"}]},
    {events:[{name:"trial_started",properties:["98% success"]}]},
    {preLaunchChecklist:["Guarantee conversion before launch"]},
  ]) assert.ok(validatePlan(brief,{...plan,...change}).issues.some(x=>["banned_claim","unsupported_claim"].includes(x.code)));
  const sourcedBrief={...brief,suppliedFacts:["Serving 500 teams"]};
  const sourced={...plan,guardrailMetrics:["Serving 500 teams"]};
  assert.equal(validatePlan(sourcedBrief,sourced).valid,true);
  assert.ok(validatePlan({...brief,suppliedFacts:["Serving 400 teams"]},sourced).issues.some(x=>x.code==="unsupported_claim"));
  const unsupportedBrief={...brief,changeIdea:"Trusted by 500 teams"};
  assert.equal(reviewTestBrief(unsupportedBrief).canApprove,false);
  assert.throws(()=>approveTestBrief({brief:unsupportedBrief,approvalAction:"approve"}),/Proof-like claim/);
});

async function post(base,name,args,id=1){const response=await fetch(`${base}/mcp`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id,method:"tools/call",params:{name,arguments:args}})});return(await response.json()).result}
async function rpc(base,body){const response=await fetch(`${base}/mcp`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify(body)});return {response,body:await response.json()}}
async function fixture(t){const server=createHttpServer().listen(0,"127.0.0.1");await once(server,"listening");t.after(()=>server.close());return`http://127.0.0.1:${server.address().port}`}
function assertSchema(value,schema,path="result"){if(schema.anyOf){assert.ok(schema.anyOf.some(option=>{try{assertSchema(value,option,path);return true}catch{return false}}),`${path} does not match anyOf`);return}if("const" in schema)assert.equal(value,schema.const,path);if(schema.type==="object"){assert.equal(typeof value,"object",path);assert.ok(value!==null&&!Array.isArray(value),path);for(const key of schema.required||[])assert.ok(key in value,`${path}.${key} is required`);if(schema.additionalProperties===false)for(const key of Object.keys(value))assert.ok(key in (schema.properties||{}),`${path}.${key} is undeclared`);for(const [key,item] of Object.entries(value))if(schema.properties?.[key])assertSchema(item,schema.properties[key],`${path}.${key}`)}else if(schema.type==="array"){assert.ok(Array.isArray(value),path);for(const [index,item] of value.entries())assertSchema(item,schema.items,`${path}[${index}]`)}else if(schema.type==="integer")assert.ok(Number.isInteger(value),path);else if(schema.type)assert.equal(typeof value,schema.type,path)}
class Element{constructor(tag="div"){this.tag=tag;this.children=[];this.beforeItems=[];this.textContent="";this.value="";this.disabled=false;this.hidden=false;this.dataset={}}append(...items){this.children.push(...items)}before(...items){this.beforeItems.push(...items)}replaceChildren(...items){this.children=[...items]}}
function widgetDocument(){const nodes=new Map,created=[],formats=["markdown","csv"].map(format=>Object.assign(new Element("button"),{dataset:{format}}));return{created,querySelector(selector){if(selector==="#copy-export")return created.find(node=>node.id==="copy-export")||null;if(!nodes.has(selector))nodes.set(selector,new Element);return nodes.get(selector)},querySelectorAll(selector){return selector==="button[data-format]"?formats:[]},createElement(tag){const node=new Element(tag);created.push(node);return node}}}
class WidgetFormData{constructor(form){this.values=form.children.filter(x=>x.name).map(x=>[x.name,x.value])}[Symbol.iterator](){return this.values[Symbol.iterator]()}}
async function runWidget(file,app,document,navigator={clipboard:{writeText:async()=>{}}}){const html=readFileSync(fileURLToPath(new URL(`../widgets/${file}`,import.meta.url)),"utf8"),script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;await new AsyncFunction("globalThis","document","FormData","navigator",script)({ExtApps:{App:class{constructor(){return app}}},navigator},document,WidgetFormData,navigator)}

test("every widget payload passes its strict schema over the real HTTP server",async t=>{const base=await fixture(t);let id=10,reviewArgs,approvalArgs,revisionArgs,planExportArgs,panelExportArgs;const call=async(name,args)=>{const result=await post(base,name,args,id++);assert.notEqual(result.isError,true,result.content?.[0]?.text);return result};const builderDocument=widgetDocument(),builderApp={async connect(){await this.ontoolresult({structuredContent:{prefill:brief}})},async callServerTool({name,arguments:args}){reviewArgs=args;return call(name,args)},async sendMessage(){}};await runWidget("brief-builder.html",builderApp,builderDocument);await builderDocument.querySelector("#form").onsubmit({preventDefault(){}});assert.deepEqual(Object.keys(reviewArgs).sort(),[...Object.keys(brief),"proofPoints","suppliedFacts"].sort());const reviewed=await call("review_test_brief",brief),reviewDocument=widgetDocument(),reviewApp={async connect(){await this.ontoolresult({structuredContent:reviewed.structuredContent})},async callServerTool({name,arguments:args}){approvalArgs=args;return call(name,args)},async sendMessage(){throw Error("denied")}};await runWidget("brief-review.html",reviewApp,reviewDocument);await reviewDocument.querySelector("#approve").onclick();assert.deepEqual(Object.keys(approvalArgs).sort(),["approvalAction","brief"]);assert.equal(reviewDocument.querySelector("#approve").disabled,false);const approved=await call("approve_test_brief",{brief,approvalAction:"approve"}),receipt=approved.structuredContent.approvalReceipt,planned=await call("plan_ab_test",{brief,approvalReceipt:receipt,plan});const planDocument=widgetDocument(),planApp={async connect(){await this.ontoolresult({structuredContent:planned.structuredContent})},async callServerTool({name,arguments:args}){if(name==="request_test_revision")revisionArgs=args;else planExportArgs=args;return call(name,args)},async sendMessage(){throw Error("denied")},async downloadFile(){return{isError:true}}};await runWidget("plan-options.html",planApp,planDocument,{clipboard:{writeText:async()=>{throw Error("denied")}}});planDocument.querySelector("#instruction").value="Keep the single changed field.";await planDocument.querySelector("#revise").onclick({target:planDocument.querySelector("#revise")});assert.deepEqual(revisionArgs,{instruction:"Keep the single changed field."});assert.equal(planDocument.querySelector("#revise").disabled,false);await planDocument.querySelector("#export").onclick({target:planDocument.querySelector("#export")});assert.deepEqual(Object.keys(planExportArgs).sort(),["approvalReceipt","brief","format","plan"]);assert.equal(planDocument.querySelector("#export").disabled,false);assert.match(planDocument.querySelector("#status").textContent,/Download unavailable/);await planDocument.querySelector("#copy").onclick();assert.match(planDocument.querySelector("#status").textContent,/Copy was refused/);const exportDocument=widgetDocument(),exportApp={async connect(){await this.ontoolinput({arguments:{brief,approvalReceipt:receipt,plan}})},async callServerTool({name,arguments:args}){panelExportArgs=args;return call(name,args)},async sendMessage(){throw Error("denied")},async downloadFile(){return{}}};await runWidget("export-panel.html",exportApp,exportDocument);const exportButton=exportDocument.querySelectorAll("button[data-format]")[0];await exportButton.onclick();assert.equal(exportButton.disabled,false);assert.deepEqual(Object.keys(panelExportArgs).sort(),["approvalReceipt","brief","format","plan"]);const copyButton=exportDocument.querySelector("#file").beforeItems[0];await copyButton.onclick();assert.equal(exportDocument.querySelector("#status").textContent,"Export copied.")});

test("MCP inventory exposes exact contract metadata and every real result conforms",async t=>{const base=await fixture(t);await rpc(base,{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"test",version:"1"}}});const tools=(await rpc(base,{jsonrpc:"2.0",id:2,method:"tools/list"})).body.result.tools;assert.deepEqual(tools.map(x=>x.name),["open_test_brief","review_test_brief","approve_test_brief","plan_ab_test","request_test_revision","export_test_plan"]);for(const tool of tools){assert.match(tool.description,/^Use this when .*Do not use for /);assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});assert.equal(tool.outputSchema.additionalProperties,false)}assert.deepEqual(tools.find(x=>x.name==="approve_test_brief")._meta.ui.visibility,["app"]);const results={};results.open_test_brief=await post(base,"open_test_brief",{},3);results.review_test_brief=await post(base,"review_test_brief",brief,4);results.approve_test_brief=await post(base,"approve_test_brief",{brief,approvalAction:"approve"},5);const approvalReceipt=results.approve_test_brief.structuredContent.approvalReceipt;results.plan_ab_test=await post(base,"plan_ab_test",{brief,approvalReceipt,plan},6);results.request_test_revision=await post(base,"request_test_revision",{instruction:"Keep the single changed field."},7);results.export_test_plan=await post(base,"export_test_plan",{brief,approvalReceipt,plan,format:"markdown"},8);for(const tool of tools){assert.notEqual(results[tool.name].isError,true,tool.name);assertSchema(results[tool.name].structuredContent,tool.outputSchema,tool.name)}});

test("widget resources are bundled IIFEs with closed CSP",async t=>{const base=await fixture(t);await rpc(base,{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"test",version:"1"}}});const resources=(await rpc(base,{jsonrpc:"2.0",id:2,method:"resources/list"})).body.result.resources;assert.equal(resources.length,4);for(const [index,resource] of resources.entries()){const item=(await rpc(base,{jsonrpc:"2.0",id:10+index,method:"resources/read",params:{uri:resource.uri}})).body.result.contents[0];assert.equal(item.mimeType,"text/html;profile=mcp-app");assert.doesNotMatch(item.text,/__EXT_APPS_BUNDLE__/);assert.match(item.text,/\(\(\)=>\{/);const scripts=[...item.text.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(x=>x[1]);assert.equal(scripts.length,1);Object.getPrototypeOf(async function(){}).constructor(scripts[0]);assert.deepEqual(item._meta.ui.csp,{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]})}});

test("receipts gate planning and export and reject another 40-character signing key",()=>{assert.throws(()=>planAbTest({brief,plan}),/approvalReceipt/);assert.throws(()=>exportTestPlan({brief,plan,format:"markdown"}),/approvalReceipt/);const receipt=approveTestBrief({brief,approvalAction:"approve"}).approvalReceipt,unsigned={kind:receipt.kind,deployment:receipt.deployment,digest:receipt.digest},otherKey="another-test-signing-key-with-40-chars!!",forged={...receipt,signature:createHmac("sha256",otherKey).update(JSON.stringify(unsigned)).digest("hex")};assert.equal(otherKey.length,40);assert.throws(()=>planAbTest({brief,plan,approvalReceipt:forged}),/receipt/i);const out=exportTestPlan({brief,plan,approvalReceipt:receipt,format:"markdown"});assert.equal(out.fileName,"ab-test-plan.md");assert.match(out.content,/A\/B Test Plan/)});

test("invalid SDK calls for every tool retain attribution",async t=>{const base=await fixture(t);for(const [index,name] of ["open_test_brief","review_test_brief","approve_test_brief","plan_ab_test","request_test_revision","export_test_plan"].entries()){const result=await post(base,name,{unexpected:true},20+index);assert.equal(result.isError,true,name);assert.match(result.content.filter(x=>x.type==="text").at(-1).text,/Provided by ASTUDIO[\s\S]*ab-test-planner$/,name)}});

test("CSV export neutralises spreadsheet formula cells",()=>{const riskyBrief={...brief,suppliedFacts:["-1"]},receipt=approveTestBrief({brief:riskyBrief,approvalAction:"approve"}).approvalReceipt;const risky={...plan,events:[["trial_started","=cmd"],["page_viewed","+sum"],["form_submitted","-1"],["button_clicked","@user"]].map(([name,property])=>({name,properties:[property]}))};const out=exportTestPlan({brief:riskyBrief,plan:risky,approvalReceipt:receipt,format:"csv"});for(const value of ["'=cmd","'+sum","'-1","'@user"])assert.ok(out.content.includes(value),value)});

test("pinned rule probes each have an accepted and rejected case",()=>{
  for(const primaryMetric of ["signup; purchase","signup + purchase","signup and purchase","signup/purchase"])assert.equal(reviewTestBrief({...brief,primaryMetric}).canApprove,false);
  assert.equal(reviewTestBrief(brief).canApprove,true);
  for(const change of ["Change headline, change button","Change headline. Change button","Change headline + change button"])assert.ok(validatePlan(brief,{...plan,variants:[plan.variants[0],{name:"Variant",change}]}).issues.some(x=>x.code==="multiple_changes"));
  assert.equal(validatePlan(brief,{...plan,variants:[plan.variants[0],{name:"Variant",change:"Change the headline to a question"}]}).valid,true);
  assert.equal(validatePlan(brief,{...plan,events:[{name:"checkout_payment_completed",properties:["variant"]}]}).valid,true);
  assert.ok(validatePlan(brief,{...plan,events:[{name:"Checkout-Paid",properties:["variant"]}]}).issues.some(x=>x.code==="event_name"));
  assert.equal(reviewTestBrief({...brief,suppliedFacts:["Guaranteed results"]}).canApprove,false);
  assert.ok(validatePlan(brief,{...plan,preLaunchChecklist:["one","two"]}).issues.some(x=>x.code==="prelaunch_checklist"));
  assert.equal(validatePlan(brief,{...plan,preLaunchChecklist:["one","two","three"]}).valid,true);
  const sourcedBrief={...brief,suppliedFacts:["Trusted by 500 teams"]};
  assert.equal(validatePlan(sourcedBrief,{...plan,guardrailMetrics:["Trusted by 500 teams"]}).valid,true);
  assert.ok(validatePlan(sourcedBrief,{...plan,guardrailMetrics:["Trusted by 500 teams with 99% satisfaction"]}).issues.some(x=>x.code==="unsupported_claim"));
});

test("health, malformed JSON, and aborted requests are contained",async t=>{const base=await fixture(t);for(const route of ["health","ready"]){const response=await fetch(`${base}/${route}`);assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");assert.deepEqual(await response.json(),{status:"ok",service:"ab-test-planner",version:"1.0.0",persistence:false,outbound_network:false})}const errors=[],originalError=console.error;console.error=(...args)=>errors.push(args);t.after(()=>{console.error=originalError});const malformed=await fetch(`${base}/mcp`,{method:"POST",headers:{"content-type":"application/json"},body:"{"});assert.equal(malformed.status,400);assert.equal(errors.length,1);assert.equal(errors[0].length,1);assert.match(errors[0][0],/^POST \/mcp: .*JSON/);const {request}=await import("node:http");await new Promise(resolve=>{const req=request(`${base}/mcp`,{method:"POST",headers:{"content-type":"application/json"}});req.on("error",()=>resolve());req.write('{"jsonrpc":');req.destroy();setImmediate(resolve)});assert.equal((await fetch(`${base}/health`)).status,200)});
