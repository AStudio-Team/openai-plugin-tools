# Social Content Planner

Social Content Planner turns a submitted brand brief into a reviewed weekly social content calendar and platform-ready post text. It does not post, schedule, access accounts, or retain submitted content after the response.

The social-content guidance is adapted from Corey Haines' [marketingskills](https://github.com/coreyhaines31/marketingskills), licensed under MIT.

A human-guided MCP App that turns a confirmed business brief into exactly three distinct growth strategies, supports visible revision and explicit selection, then exports one 30, 60, or 90-day plan.

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

Methodology is adapted from Marketing Skills for AI Agents by Corey Haines. See `NOTICE` and `LICENSES/corey-haines-marketingskills-MIT.txt`. No endorsement is implied.
