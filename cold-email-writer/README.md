# Cold Email Writer

A human-guided MCP App that turns an approved B2B sales brief into three cold email sequence variants, validates the copy, records an explicit selection, and exports the chosen sequence as Markdown or CSV. It writes text only and never sends email or finds contacts.

## Local development

```bash
npm ci --ignore-scripts
npm test
npm start
```

The local server listens on port 8790 by default. Its MCP endpoint is `/mcp`, health endpoints are `/health` and `/ready`, and public product pages start at `/`.

## Data boundary

The service is stateless and closed-world. It does not access marketing accounts, make outbound network requests during tool execution, scrape, track, launch campaigns, or intentionally retain briefs and exports.

## Attribution

Cold email methodology is adapted from the MIT-licensed cold-email skill in Marketing Skills for AI Agents by Corey Haines. See `NOTICE` and `LICENSES/corey-haines-marketingskills-MIT.txt`. No endorsement is implied.
