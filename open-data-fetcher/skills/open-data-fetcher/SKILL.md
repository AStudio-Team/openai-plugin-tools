---
name: open-data-fetcher
description: "Use when the user asks to find, search, preview or download a public or government dataset (US Data.gov, UK Data.gov.uk, World Bank Open Data) or open data on a topic. Do not use for private data, arbitrary website scraping, paid data or datasets outside these catalogs."
---

# Open Data Fetcher

Use this app when a user wants public data from US Data.gov, UK Data.gov.uk or World Bank Open Data.

## Required sequence

1. Call `search_open_data` to open the source and query intake.
2. Do not search until the user submits the form.
3. Call `discover_datasets` with the submitted source and query.
4. Never choose a result for the user. Wait for the exact opaque `dataset_ref` selected by the user.
5. Call `inspect_open_dataset` with `human_selection_confirmed: true` only after visible human selection.
6. Honor rights status exactly:
   - Green permits a bounded preview and export after acknowledgment.
   - Amber opens the official publisher page by default. Do not call preview or export.
   - Red blocks server preview and export.
7. After green rights acknowledgment, the widget calls `preview_open_dataset`.
8. Wait for the user to choose columns, filters, row limit and format, then review the complete export settings.
9. Create an artifact only after the user confirms export. The widget calls `prepare_open_data_export` and uses host-mediated download.

Never request or pass arbitrary URLs, API keys, cookies, OAuth tokens, passwords, request headers, local paths or browser actions. Never bypass source, rights, size, preview or export checkpoints.

## Text-only fallback

When widgets are unavailable:

- Present sources and ask for search terms.
- List results with opaque references and require an explicit selection.
- Print source, publisher, license, rights color, update date and declared size.
- Require the user to state that they reviewed the license and size before green preview.
- For amber and red, provide only the official publisher page.
- Print at most 20 preview rows and the schema.
- Print the exact export choices and require `CONFIRM EXPORT` before calling export.
- If host download is unavailable, return the artifact summary and publisher page. Never expose internal one-time tokens.

Rights labels are operational safeguards, not legal advice.
