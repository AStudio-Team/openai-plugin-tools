# Schema Markup Generator

A human-guided MCP App for creating, reviewing, checking, and exporting schema.org JSON-LD from facts supplied by the user. It supports Organization, LocalBusiness, Product, Article, FAQPage, HowTo, Event, Service, Person, and BreadcrumbList markup.

## Tools and flow

1. `open_schema_brief` starts a brief and lists supported page types.
2. `review_schema_brief` checks supplied facts and identifies required fields that are missing.
3. `generate_schema_markup` uses an explicit approval receipt for the exact reviewed facts to create JSON-LD and reports recommended fields that were not supplied.
4. `check_schema_markup` deterministically checks pasted JSON-LD for JSON validity, context, type, required and recommended properties, and common mistakes.
5. `export_schema_markup` uses the approved brief to return both raw JSON and a safely escaped JSON-LD script tag.

The normal creation flow is open, review, approve, generate, then export. Checking pasted markup is available independently and does not imply eligibility for a rich result.

## Local development

```bash
npm ci --ignore-scripts
npm test
npm start
```

The local server listens on port 8790 by default. Its MCP endpoint is `/mcp`, health endpoints are `/health` and `/ready`, and public product pages start at `/`.

## Data boundary

The service is stateless and closed-world. It does not fetch URLs, scrape pages, edit or publish websites, access external accounts, make outbound network requests during tool execution, or intentionally retain briefs and exports. It marks up only facts the user supplies and does not guarantee search-engine eligibility or rich results. Users must ensure the final markup matches visible page content and keep it current.

## Attribution

Methodology is adapted from the schema-markup skill in [Marketing Skills for AI Agents](https://github.com/coreyhaines31/marketingskills) by Corey Haines, under the MIT License. See `NOTICE` and `LICENSES/corey-haines-marketingskills-MIT.txt`. Modifications and product implementation are by ASTUDIO; no endorsement is implied.
