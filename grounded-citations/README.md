# Grounded Citations

A remote human-interactive MCP App that turns user-provided sources into a session-scoped citation ledger, verifies exact quote occurrence, and checks draft citation integrity.

## Product shape

- `plugin-package/`: minimal public submission package
- `server/`: Streamable HTTP MCP server, core modules, widgets, and tests
- `public/`: product, privacy, terms, and support pages
- `review/`: deterministic fixture and exact review case record

## Local verification

```bash
npm --prefix server ci --ignore-scripts
npm --prefix server test
npm --prefix server run check
npm --prefix server audit
npm --prefix server run licenses
```

The default store is bounded in-memory state with a 2-hour idle expiry, 24-hour hard expiry, and immediate deletion. Production startup fails closed if an unsupported persistence setting is requested. No external paid service is required.

## Publication gates

Deployment, ChatGPT installation, portal upload, submission, and publication are not performed by local build tasks. They require separate approval and real public HTTPS verification.
