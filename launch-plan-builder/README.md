# Launch Plan Builder

A human-guided MCP App that turns an approved product launch brief into a dated plan across pre-launch, launch week, and post-launch phases. Each task has an owner, channel, and deliverable. The plan can be revised visibly and exported as Markdown or CSV.

## Local development

```bash
npm ci --ignore-scripts
npm test
npm start
```

The local server listens on port 8790 by default. Its MCP endpoint is `/mcp`, health endpoints are `/health` and `/ready`, and public product pages start at `/`.

## Data boundary

The service is stateless and closed-world. It does not access marketing accounts, make outbound network requests during tool execution, scrape, track, launch campaigns, or intentionally retain briefs and exports. `APPROVAL_HMAC_KEY` is required to issue and verify time-limited approval receipts.

## Attribution

Launch-planning methodology is adapted from the launch-strategy skill in Marketing Skills for AI Agents by Corey Haines, under the MIT License. See `NOTICE` and `LICENSES/corey-haines-marketingskills-MIT.txt`. No endorsement is implied.
