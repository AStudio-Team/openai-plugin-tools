import test from "node:test";
import assert from "node:assert/strict";
import { createHttpServer, reviewSchemaBrief, checkSchemaMarkup } from "../src/server.mjs";

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
