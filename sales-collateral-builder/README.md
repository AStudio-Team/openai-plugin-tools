# Sales Collateral Builder

A human-guided MCP App for collecting a sales collateral brief, validating a pasted sales deck outline, one-pager, objection handling sheet, demo script, or case study brief, and exporting the supplied text as Markdown or HTML.

## Local development

```bash
npm ci --ignore-scripts
APPROVAL_HMAC_KEY="replace-with-at-least-32-random-characters" npm test
APPROVAL_HMAC_KEY="replace-with-at-least-32-random-characters" npm start
```

`APPROVAL_HMAC_KEY` signs collateral brief approvals. Set it explicitly for local runs; production receives it from the deployment environment file.

The local server listens on port 8790 by default. Its MCP endpoint is `/mcp`, health endpoints are `/health` and `/ready`, and public product pages start at `/`.

## Data boundary

The service is stateless and closed-world. It does not fetch URLs, send or publish content, connect to accounts or tools, make outbound network requests during tool execution, or intentionally retain briefs and exports.

## Attribution

Methodology is adapted from Marketing Skills for AI Agents by Corey Haines. See `NOTICE` and `LICENSES/corey-haines-marketingskills-MIT.txt`. No endorsement is implied.
