---
name: editable-diagram-builder
description: "Use when the user asks for a flowchart, process flow, system architecture diagram, sequence diagram, concept map or mind map from a description, and wants to review it and download an editable .excalidraw file. Do not use for charts from data, slide decks, image generation or diagrams in other file formats."
version: 1.0.0
license: MIT
---

# Editable Diagram Builder

## Required flow

1. Confirm the request is one of the four supported diagram types. Refuse posters, general illustration, CAD, collaboration, arbitrary binary editing, automatic upload and public share links.
2. Call `open_diagram_brief` with all context already provided. Do not ask again for known information.
3. Let the user review and explicitly approve the normalized brief. Never treat silence as approval.
4. Call `confirm_diagram_brief` with the exact brief and digest. Keep its checkpoint token private to the current flow.
5. Perform semantic reasoning in the host model. Create a `DiagramScene` with meaningful nodes, groups and relationships. The server validates and compiles; it does not infer business meaning.
6. Call `render_diagram_preview`. Present its complete text fallback even if the host does not render MCP Apps.
7. For visual changes, use `apply_diagram_edits`. For scope, purpose, type or protected-term changes, return to a new brief checkpoint.
8. Call `export_excalidraw` only after a valid preview and user selection. The widget uses `app.downloadFile`. Never upload the file or promise a share link.

## Limits

- 100 nodes, 160 edges, 30 groups and 50 edits per call.
- Labels are at most 200 characters.
- The preview result is capped near 130 KB and final output at 512 KB.
- No external network, database, analytics or retained content.

## Compatibility wording

Use `.excalidraw` only as factual file-format compatibility wording. State that the product is independent and is not endorsed by the Excalidraw project. Do not describe it as official.
