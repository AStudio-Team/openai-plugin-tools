---
name: ab-test-planner
description: "Plan and validate a text-only A/B test, including sample size, duration, metrics, events, and stopping rules."
---

# A/B Test Planner

Use this skill to turn a supplied experiment brief into a practical A/B test plan. It does not access websites, analytics accounts, or live experiments.

## Plan method

1. Capture the page or feature, one proposed change, a primary metric, baseline conversion rate, weekly visitors, relative minimum detectable effect, variants, confidence, and power.
2. State the hypothesis as: Because [insight], we believe [change] will [expected effect], measured by [primary metric].
3. Name at least one guardrail metric. Give every tracking event an `object_action` name and its properties.
4. Include pre-launch checks and a stop rule that forbids stopping early because interim results look favourable or unfavourable.
5. Use the two-proportion sample-size calculation and the supplied traffic to estimate whole weeks. Treat the output as planning guidance, not a promised result.

## Attribution

This skill adapts the `ab-test-setup` and `analytics-tracking` skills from Corey Haines' marketingskills, under the MIT License. The adaptation is for A/B Test Planner by ASTUDIO.
