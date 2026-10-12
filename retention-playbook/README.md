# Retention Playbook

A human-guided MCP App for building and checking customer retention playbooks. It collects a retention brief, requires explicit in-app approval, validates six retention plays, and exports an approved playbook as Markdown or CSV.

## Local development

```bash
npm ci --ignore-scripts
APPROVAL_HMAC_KEY="replace-with-at-least-32-random-characters" npm test
APPROVAL_HMAC_KEY="replace-with-at-least-32-random-characters" npm start
```

`APPROVAL_HMAC_KEY` signs brief approvals. Set it explicitly for local runs; production receives it from the deployment environment file.

The local server listens on port 8790 by default. Its MCP endpoint is `/mcp`, health endpoints are `/health` and `/ready`, and public product pages start at `/`.

## Data boundary

The service is stateless and closed-world. It does not fetch URLs, change accounts, send messages, make outbound network requests during tool execution, or intentionally retain briefs and exports. It writes and checks text only and does not promise churn outcomes.

## Attribution

Methodology is adapted from the churn-prevention, onboarding-cro, and referral-program skills in Marketing Skills for AI Agents by Corey Haines. See `NOTICE` and `LICENSES/corey-haines-marketingskills-MIT.txt`. No endorsement is implied.
