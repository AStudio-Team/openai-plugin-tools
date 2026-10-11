# Editable Diagram Builder

A public, authless, stateless MCP App for creating human-reviewed editable diagrams and downloading native `.excalidraw` JSON files.

## Supported diagrams

- Flowcharts
- System architecture diagrams
- Sequence diagrams
- Concept maps

The host model owns semantic reasoning. The server deterministically validates, lays out, compiles and serializes the scene. A mandatory brief checkpoint prevents generation before explicit human approval.

## Local development

```bash
npm ci --ignore-scripts
CHECKPOINT_SECRET=local-development-secret-at-least-32-bytes npm test
CHECKPOINT_SECRET=local-development-secret-at-least-32-bytes npm start
```

The MCP endpoint is `http://127.0.0.1:8790/mcp`. Health endpoints are `/health` and `/ready`.

## Privacy and network behavior

The service has no database, object storage, analytics or outbound application network calls. Diagram content is processed in memory and discarded after each response. Logs contain request metadata, not diagram content. It never uploads files or creates public share links.

## Compatibility notice

This product creates files compatible with the open `.excalidraw` JSON format. It is an independent product and is not affiliated with, sponsored by or endorsed by the Excalidraw project. No Excalidraw logo, mascot, editor code, fonts or visual identity are included.

## License

ASTUDIO source is MIT licensed. See `THIRD_PARTY_NOTICES.md` for production dependencies and compatibility attribution.
