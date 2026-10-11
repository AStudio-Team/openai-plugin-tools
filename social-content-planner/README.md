# Social Content Planner

Social Content Planner turns a user-confirmed brand brief into a validated, platform-ready social content calendar. It plans content only: nothing is posted or scheduled, and it does not access social accounts.

## Flow and tools

1. `open_social_brief` opens a brief using only facts supplied by the user.
2. `review_social_brief` normalizes the complete brief for the user to inspect.
3. `approve_social_brief` is called only by the user's explicit approval in the review widget.
4. `draft_content_calendar` drafts posts within the approved pillars, platforms, weekly post volume, and banned topics, then validates the calendar.
5. `request_calendar_revision` records a user-requested revision for a week or individual post.
6. `export_content_calendar` exports validated calendars as CSV and Markdown.

The calendar cannot be drafted before approval. Every issue from calendar validation must be corrected before export. Revisions use the visible revision flow and are revalidated before export.

## Limits

The service is stateless and closed-world. It does not publish, schedule, access accounts, send messages, buy ads, scrape, track, make outbound requests during tool execution, or intentionally retain submitted briefs and exports. It does not promise engagement, followers, leads, sales, or other results.

## Local development

```bash
npm ci --ignore-scripts
export APPROVAL_HMAC_KEY="$(openssl rand -hex 32)"
npm test
npm start
```

The deployment supplies `APPROVAL_HMAC_KEY` through its environment file.

The local server listens on port 8790 by default. Its MCP endpoint is `/mcp`, health endpoints are `/health` and `/ready`, and public product pages start at `/`.

## Attribution

Social-content guidance is adapted from Corey Haines' [marketingskills](https://github.com/coreyhaines31/marketingskills) social-content skill, licensed under MIT. See `NOTICE` and `LICENSES/corey-haines-marketingskills-MIT.txt`. No endorsement is implied.
