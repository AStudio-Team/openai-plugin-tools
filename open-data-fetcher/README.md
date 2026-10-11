# Open Data Fetcher

Open Data Fetcher is an authless, human-controlled MCP App for finding and exporting datasets from three approved official sources:

- US Data.gov
- UK Data.gov.uk
- World Bank Open Data

## Human flow

1. The person submits a source and search query.
2. The person explicitly chooses a dataset.
3. The app shows a blocking license and size checkpoint.
4. Green rights permit bounded preview. Amber opens the publisher by default. Red blocks preview and export.
5. The person chooses columns, filters, row limit and format.
6. The person reviews and confirms the export.
7. The widget uses host-mediated download. Temporary links are one-time and expire.

No tool accepts arbitrary URLs, credentials, request headers or local files. No browser automation is used.

## Local development

```bash
npm ci --ignore-scripts
npm test
npm run check
npm start
```

The MCP endpoint is `http://127.0.0.1:8791/mcp`. Health is at `/health`.

## Configuration

- `PORT`: HTTP port, default `8791`
- `ALLOWED_HOSTS`: comma-separated incoming host allowlist
- `PUBLIC_BASE_URL`: public base used for one-time downloads
- `APP_ORIGIN`: published widget domain metadata
- `FLOW_SIGNING_KEY`: optional server-side HMAC secret. Production should set a high-entropy value.
- `OPENAI_APPS_CHALLENGE`: exact challenge response, set only in the deployment secret store

## Security limits

- 256 KB MCP request body
- 200 preview rows and 5 MB preview input
- 5,000,000 export rows and 250 columns
- 250 MB remote response and artifact
- HTTPS port 443 only
- Three redirects, each revalidated against the adapter allowlist
- Private, loopback, link-local, reserved and metadata addresses blocked
- Archives validated and rejected from export in version 1

## License

MIT
