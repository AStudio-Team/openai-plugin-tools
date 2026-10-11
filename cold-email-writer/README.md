# Cold Email Writer

A human-guided MCP App that turns an approved B2B sales brief into three cold email sequence variants, validates the copy, records an explicit selection, and exports the chosen sequence as Markdown or CSV. It writes text only and never sends email or finds contacts.

## Local development

```bash
npm ci --ignore-scripts
export APPROVAL_HMAC_KEY=<32 or more random bytes>
npm test
npm start
```

The local server listens on port 8790 by default. Its MCP endpoint is `/mcp`, health endpoints are `/health` and `/ready`, and public product pages start at `/`.

Production requires `APPROVAL_HMAC_KEY` to contain at least 32 characters. The deployment supplies `APPROVAL_HMAC_KEY` through its environment file; the service refuses to start without it.

## Data boundary

The service is stateless and closed-world. It does not access marketing accounts, make outbound network requests during tool execution, scrape, track, launch campaigns, or intentionally retain briefs and exports.

## Attribution

Cold email methodology is adapted from the MIT-licensed cold-email skill in Marketing Skills for AI Agents by Corey Haines. See `NOTICE` and `LICENSES/corey-haines-marketingskills-MIT.txt`. No endorsement is implied.
