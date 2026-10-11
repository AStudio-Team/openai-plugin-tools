# Verified Buy Link

Verified Buy Link is a remote, anonymous MCP App for comparing one to five exact product-page URLs supplied by the user. It provides an intake checkpoint, source-compliant bounded retrieval, evidence comparison, human selection and an immediate recheck before a normalized product page can open.

## Hard boundaries

- No retailer discovery or arbitrary search
- No purchase, reservation, cart, checkout, login, forms, messages or uploads
- No payment, address or credential collection
- No absolute retailer, product, authorization, authenticity or safety claims
- No product-page fetch without a current source-rights record and robots permission

## Local development

```bash
npm ci --ignore-scripts
npm test
npm start
```

The MCP endpoint is `http://127.0.0.1:8790/mcp`. Public pages are served from the same process. Production accepts HTTPS product URLs only.

## Source-rights register

`source-rights-register.json` intentionally ships with no approved retailer domains. To enable a domain, legal and terms review must add every required field, including the exact access basis, terms URL, permitted fields, caching, attribution, geography, rate limit and owner. Set `SOURCE_RIGHTS_FILE` to a reviewed register mounted outside the immutable container if production policy requires separate change control.

Supplying a URL does not create permission to fetch it. Missing, expired, restrictive or contradictory source evidence fails closed.

## Security model

- HTTPS and ports 443 only in production
- IDN normalization and tracking-parameter removal
- DNS checks on every hop, public-IP enforcement and address pinning
- Maximum three same-domain redirects
- TLS verification, request deadlines, header and decompressed body caps
- No raw HTML returned to the model or widget
- Encrypted in-memory reports with a fixed 30-minute maximum lifetime
- Ephemeral HMAC abuse buckets without raw IP storage
- Empty widget `frameDomains`, `connectDomains` and `resourceDomains`

## Release checks

```bash
npm test
npm audit --audit-level=high
python3 ../tests/validate_packages.py
python3 ../tests/audit_public_content.py
python3 ../tests/build_archives.py
```

A reviewer-accessible video and cross-platform ChatGPT web and mobile evidence remain portal-time gates. Do not upload or submit the package until those external gates pass.