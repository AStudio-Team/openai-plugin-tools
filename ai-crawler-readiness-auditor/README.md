# AI Crawler Readiness Auditor

A stateless, human-interactive MCP App that audits one public HTTPS page and origin-level crawler controls. It validates the target first, requires a signed 15-minute checkpoint token, then returns bounded evidence and unselected remediation choices.

## Local development

```bash
npm ci
npm test
npm run check
npm audit --audit-level=high
npm run licenses
npm run sbom
npm start
```

The local MCP endpoint is `http://127.0.0.1:8790/mcp`. Production remains gated and is not deployed by this source change.

## Checks

- HTTPS response, redirects, content type, and challenge signals
- Effective robots.txt rules for configured neutral crawler tokens
- X-Robots-Tag and page robots metadata
- Title, description, canonical URL, and server-delivered text
- JSON-LD parsing without execution
- Bounded sitemap XML parsing without DTD or entity processing
- llms.txt and llms-full.txt content validation

The app produces no numeric readiness score and makes no ranking, indexing, citation, traffic, or training guarantee.

## Security and privacy

Each outbound HTTPS connection resolves all addresses, rejects any non-global destination, pins a validated address into TLS, retains the hostname for SNI and certificate checks, and verifies the connected peer. Redirects are independently validated. The app is stateless and logs only operational counts and latency.

## License

MIT. See `NOTICE`, `THIRD_PARTY_LICENSES.json`, and `sbom.cdx.json`.
