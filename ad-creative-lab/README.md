# Ad Creative Lab

Ad Creative Lab is an authless, stateless MCP App for building a campaign brief, approving it at a signed human checkpoint, comparing 3 to 5 model-generated text concepts, selecting or revising, validating copy deterministically, and exporting CSV, JSON, or Markdown.

It never accesses ad accounts, publishes ads, predicts performance, accepts private client performance data, fetches landing pages, or generates images or video.

## Run locally

```bash
npm ci --ignore-scripts
npm test
APPROVAL_HMAC_KEY=replace-with-at-least-32-random-characters npm start
```

The service listens on `PORT` or 8790. Health is `GET /`. MCP is `/mcp`. Production requires HTTPS at the reverse proxy and a secret signing key of at least 32 characters.

## Human flow

1. `prepare_campaign_brief` opens the guided editor.
2. `review_campaign_brief` shows the complete checkpoint.
3. The person checks all four confirmations.
4. `approve_campaign_brief` issues a signed, session-bound receipt for 30 minutes.
5. The host model creates text concepts and calls `present_concept_options`.
6. The person selects, requests revision, or changes the brief.
7. `validate_platform_copy` applies the versioned deterministic profile.
8. `export_creative_package` produces local files only.

Every tool includes a text fallback. Widgets use standard MCP Apps resources and bridge methods.

## Platform profile

`data/platform-specs.v1.json` records official source URLs, source titles, profile version and retrieval date for every rule. Review it every 90 days. Requirements can change, so every validation and export asks the user to confirm final copy in the platform preview.

## License and attribution

MIT. See `THIRD_PARTY_NOTICES.md` for the retained Corey Haines notice and license.
