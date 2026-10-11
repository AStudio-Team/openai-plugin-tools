import test from "node:test";
import assert from "node:assert/strict";
import { createHttpServer, reviewSchemaBrief, approveSchemaBrief, generateSchemaMarkup, exportSchemaMarkup, checkSchemaMarkup } from "../src/server.mjs";

async function listen(server){await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));return server.address().port;}

test("raw HTTP facts reject prototype-named properties before zod",async t=>{
  const server=createHttpServer(),port=await listen(server);t.after(()=>server.close());
  const body='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"review_schema_brief","arguments":{"pageType":"Organization","pageUrl":"https://example.test","facts":{"name":"Example","url":"https://example.test","__proto__":{"polluted":true}}}}}';
  const response=await fetch(`http://127.0.0.1:${port}/mcp`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream"},body});
  const result=await response.json();
  assert.equal(result.result.structuredContent.canApprove,false);
  assert.ok(result.result.structuredContent.invalid.some(issue=>issue.path==="facts.__proto__"&&issue.message.includes("Prototype-named property")));
  assert.equal(result.result.structuredContent.approvalReceipt,undefined);
});

test("non-string URLs, dates and nested types block review and reduce checker score",()=>{
  for(const [type,facts,path] of [
    ["Person",{name:"A","@id":42},"facts.@id"],
    ["Organization",{name:"A",url:"https://example.test",foundingDate:2012},"facts.foundingDate"],
    ["FAQPage",{mainEntity:[{"@type":42,name:"Q",acceptedAnswer:{"@type":"Answer",text:"A"}}]},"facts.mainEntity.0.@type"]
  ]){
    const brief={pageType:type,pageUrl:"https://example.test",facts},reviewed=reviewSchemaBrief(brief);
    assert.equal(reviewed.canApprove,false,path);
    assert.ok(reviewed.invalid.some(issue=>issue.path===path),path);
    const checked=checkSchemaMarkup({jsonLd:JSON.stringify({"@context":"https://schema.org","@type":type,...facts})});
    assert.ok(checked.score<100,path);
    assert.ok(checked.reasons.some(reason=>reason.includes(path)),path);
  }
});

test("checker applies HTTPS URL policy to Product url",()=>{
  const checked=checkSchemaMarkup({jsonLd:JSON.stringify({"@context":"https://schema.org","@type":"Product",name:"Bag",url:"http://not-https.test",image:"https://example.test/bag.jpg",offers:{price:"10",priceCurrency:"AED",availability:"https://schema.org/InStock"},sku:"B1",brand:"Brand"})});
  assert.ok(checked.score<100);
  assert.ok(checked.reasons.some(reason=>reason.includes("facts.url")&&reason.includes("HTTPS")));
});

test("typed nested objects approve across supported parent properties",()=>{
  const cases=[
    ["Organization",{name:"A",url:"https://example.test",parentOrganization:{"@type":"Organization",name:"Parent"}}],
    ["LocalBusiness",{name:"A",address:"Dubai",geo:{"@type":"GeoCoordinates",latitude:25.2,longitude:55.3}}],
    ["Product",{name:"P",image:"https://example.test/p.jpg",offers:{"@type":"Offer",price:10,availability:"https://schema.org/InStock"},manufacturer:{"@type":"Organization",name:"Maker"}}],
    ["Article",{headline:"H",image:"https://example.test/a.jpg",datePublished:"2026-10-12",author:{"@type":"Person",name:"A"},mainEntityOfPage:{"@type":"WebPage","@id":"https://example.test/article"}}],
    ["WebSite",{name:"Site",url:"https://example.test",mainEntity:{"@type":"Organization",name:"A"}}],
    ["Person",{name:"A",worksFor:{"@type":"Organization",name:"Employer"}}]
  ];
  for(const [pageType,facts] of cases){
    const brief={pageType,pageUrl:"https://example.test/page",facts},reviewed=reviewSchemaBrief(brief);
    assert.equal(reviewed.canApprove,true,`${pageType}: ${JSON.stringify(reviewed.invalid)}`);
    const receipt=approveSchemaBrief(brief).approvalReceipt;
    assert.deepEqual(generateSchemaMarkup({brief,approvalReceipt:receipt}).markup[facts.mainEntity?"mainEntity":Object.keys(facts).at(-1)],facts[Object.keys(facts).at(-1)]);
    assert.match(exportSchemaMarkup({brief,approvalReceipt:receipt}).rawJson,/"@context": "https:\/\/schema.org"/);
  }
});

test("empty or untyped nested objects block while uncommon PascalCase types warn",()=>{
  for(const [pageType,facts,path] of [
    ["Person",{name:"A",jobTitle:{}},"facts.jobTitle"],
    ["Organization",{name:"A",url:"https://example.test",knowsLanguage:{}},"facts.knowsLanguage"]
  ]){
    const reviewed=reviewSchemaBrief({pageType,pageUrl:"https://example.test",facts});
    assert.equal(reviewed.canApprove,false);
    assert.ok(reviewed.invalid.some(issue=>issue.path===path&&issue.message==="empty or untyped object"));
  }
  const brief={pageType:"Organization",pageUrl:"https://example.test",facts:{name:"A",url:"https://example.test",customFact:{"@type":"CustomThing",name:"Kept"}}},reviewed=reviewSchemaBrief(brief);
  assert.equal(reviewed.canApprove,true,JSON.stringify(reviewed.invalid));
  assert.ok(reviewed.warnings.some(message=>message.includes("uncommon nested type, kept as supplied")));
  const checked=checkSchemaMarkup({jsonLd:JSON.stringify({"@context":"https://schema.org","@type":"Organization",...brief.facts})});
  assert.deepEqual(checked.commonMistakes,[]);
  assert.ok(checked.warnings.some(message=>message.includes("uncommon nested type, kept as supplied")));
});
