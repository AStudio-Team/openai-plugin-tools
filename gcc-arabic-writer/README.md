# GCC Arabic Writer

A standalone OpenAI plugin for Arabic marketing copy across GCC and pan-Arab markets. ChatGPT and the bundled skill write the copy. The MCP service supplies deterministic, stateless brief normalization, factual-preservation checks and transparent lint rules without a paid LLM API.

Version 1.1.0 adds a focused MCP App brief builder. The user reviews or edits the deliverable, market, surface, voice, key message, facts, protected literals, dialect choice and constraints, then explicitly sends the reviewed brief into chat. Fidelity and lint results render in a read-only review app with visible revise or keep actions. Hosts without widgets receive complete text and structured fallbacks. MSA remains the default, and dialect-sensitive work visibly requires native-market review.

## Local verification

```bash
npm ci --ignore-scripts
npm test
npm audit --audit-level=high
```

The service exposes `/health`, `/ready` and `/mcp`. It has no persistence and performs no outbound network calls. Submitted copy and facts are not logged. Operational logs contain only the tool name, status, latency, rule count and input byte count.

## Package shape

- `plugin.json`: OpenAI plugin manifest and structured review cases.
- `mcp.json`: public streamable HTTP MCP endpoint declaration.
- `src/server.mjs`: deterministic Node 22-compatible MCP service and separately registered app resources.
- `widgets/`: focused brief and review MCP Apps with the official runtime bundle inlined at service startup.
- `skills/gcc-arabic-writer/SKILL.md`: writing workflow and tool orchestration.
- `assets/`: listing assets.

The distributable submission package contains only public product instructions, MCP configuration and listing assets. It contains no client data, private corpus, local path, credential, internal identifier or operational system reference.

## External gates

Developer identity verification, public deployment, demo recording, portal review, submission and publication require fresh approval. No public demo URL is declared until a real recording is served.
