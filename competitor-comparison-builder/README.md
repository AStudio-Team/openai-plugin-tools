# Competitor Comparison Page Builder

A human-guided MCP App that reviews a competitor comparison page brief, validates two or three copy variants, checks conversion basics, records explicit selection, and exports the selected copy as Markdown or HTML.

## Local development

```bash
npm ci --ignore-scripts
APPROVAL_HMAC_KEY="replace-with-at-least-32-random-characters" npm test
APPROVAL_HMAC_KEY="replace-with-at-least-32-random-characters" npm start
```

`APPROVAL_HMAC_KEY` signs brief approvals and copy selections. Set it explicitly for local runs; production receives it from the deployment environment file.

The local server listens on port 8790 by default. Its MCP endpoint is `/mcp`, health endpoints are `/health` and `/ready`, and public product pages start at `/`.

## Data boundary

The service is stateless and closed-world. It does not fetch URLs, change websites, make outbound network requests during tool execution, or intentionally retain briefs and exports.

## Attribution

Methodology is adapted from Marketing Skills for AI Agents by Corey Haines. See `NOTICE` and `LICENSES/corey-haines-marketingskills-MIT.txt`. No endorsement is implied.
