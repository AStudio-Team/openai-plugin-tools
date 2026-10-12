import test from "node:test";
import assert from "node:assert/strict";
import { approveTestBrief, planAbTest, sampleSize } from "../src/server.mjs";

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
