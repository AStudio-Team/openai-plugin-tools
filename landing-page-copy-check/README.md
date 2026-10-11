# Landing Page Copy Check

A human-guided MCP App that reviews a landing page brief, validates two or three copy variants, checks conversion basics, records explicit selection, and exports the selected copy as Markdown or HTML.

## Local development

```bash
npm ci --ignore-scripts
npm test
npm start
```

The local server listens on port 8790 by default. Its MCP endpoint is `/mcp`, health endpoints are `/health` and `/ready`, and public product pages start at `/`.

## Data boundary

The service is stateless and closed-world. It does not fetch URLs, change websites, make outbound network requests during tool execution, or intentionally retain briefs and exports.

## Attribution

Methodology is adapted from Marketing Skills for AI Agents by Corey Haines. See `NOTICE` and `LICENSES/corey-haines-marketingskills-MIT.txt`. No endorsement is implied.
