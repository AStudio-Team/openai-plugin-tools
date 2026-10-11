---
name: schema-markup-generator
description: Use when the user asks for JSON-LD, schema markup, structured data, FAQ schema, product schema, Organization schema, article schema, local business schema, rich results, or a schema markup check. Do not use for fetching a page, editing a website, publishing markup, or guaranteeing rich results.
metadata:
  version: 1.0.0
---

# Schema Markup Generator

Create and check schema.org JSON-LD from facts the user supplies. Do not infer facts from a URL, scrape a page, edit a site, or promise a rich result.

## Accuracy rules

- Mark up only content that exists on the page and is supplied or confirmed by the user.
- Use JSON-LD. It can be placed in a page head or at the end of the body.
- Confirm facts before generation and retain approval provenance.
- Validate JSON before export. Fully qualify URLs and use ISO 8601 dates where a date is supplied.
- Explain that Google Rich Results Test, Schema.org Validator, and Search Console are useful follow-up checks, not guarantees.
- Google retired HowTo rich results in 2023. HowTo markup can still describe visible content, but do not promise a Google HowTo rich result.
- Google retired FAQ rich results in 2026. FAQPage markup can still describe visible content, but do not promise a Google FAQ rich result.

## Supported types

| Type | Required facts |
| --- | --- |
| Organization | name, url |
| LocalBusiness | name, address |
| Product | name, image, offers |
| Article | headline, image, datePublished, author |
| FAQPage | mainEntity question and answer pairs |
| HowTo | name, step |
| Event | name, startDate, location |
| Person | name |
| BreadcrumbList | itemListElement with position, name, item |
| WebSite | name, url |

Recommended facts include logo, sameAs, and contactPoint for Organization; dateModified, publisher, and description for Article; SKU, brand, aggregateRating, and review for Product; and URLs for breadcrumb items. Missing facts are reported as not checked, never as passed.

## Validation

Check valid JSON, `@context`, `@type`, supported required and recommended properties, fully qualified URLs where supplied, and common errors such as an empty FAQ list or malformed breadcrumb positions. Use `@graph` only when the user confirms multiple applicable schema types. Never invent numeric thresholds or represent them as an upstream rule.

## Export

Return raw JSON and a safely escaped `<script type="application/ld+json">` snippet. Tell the user to ensure the final markup matches visible page content and remains current when that content changes.
