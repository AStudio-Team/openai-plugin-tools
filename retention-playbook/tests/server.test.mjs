import test from "node:test";
import assert from "node:assert/strict";
import { approveRetentionBrief, validateRetentionPlaybook } from "../src/server.mjs";
const brief={productType:"SaaS",billingModel:"monthly",activationEvent:"first project",knownCancelReasons:["price"],channelsAvailable:["email","in-app"],offersAllowed:["pause","none"],constraints:"Keep cancellation clear"};
const plays=["onboarding and activation","proactive retention","cancel flow","failed payment recovery","win-back","referral"].map(area=>({area,trigger:"Customer signal",audience:"Active customer",channel:"email",message:area==="cancel flow"?"Offer pause and continue to cancellation":"Helpful message",ownerRole:"Customer success",successMetric:"Completion rate",saveOffer:"none"}));
test("accepts valid required plays",()=>{const x=approveRetentionBrief({brief,approvalAction:"approve"});assert.equal(validateRetentionPlaybook({brief,plays,approvalReceipt:x.approvalReceipt}).valid,true)});
test("rejects blocked cancel flow",()=>{const x=approveRetentionBrief({brief,approvalAction:"approve"});plays[2]={...plays[2],message:"Hide cancel option"};assert.match(validateRetentionPlaybook({brief,plays,approvalReceipt:x.approvalReceipt}).issues.join(" "),/clear path/)});
