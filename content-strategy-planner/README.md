# Content Strategy Planner

An ASTUDIO MCP App that collects an approved content brief, validates a ChatGPT-written strategy of three to five content pillars, and exports a valid plan as CSV or Markdown.

The app works only with text and URLs the user supplies. It does not fetch sites, connect accounts, publish content, or promise traffic or rankings.

## Development

Requires Node.js 22 or later and an `APPROVAL_HMAC_KEY` of at least 32 characters.

```sh
npm install
npm test
APPROVAL_HMAC_KEY=replace-with-a-secret-at-least-32-characters npm start
```

The server listens on port 8790 by default. Health endpoints are `/health` and `/ready`; MCP requests use `/mcp`.

## Attribution

Strategy guidance is adapted from Corey Haines' marketingskills content-strategy, programmatic-seo, and site-architecture skills under the MIT License. See `NOTICE` and `LICENSES/`.
