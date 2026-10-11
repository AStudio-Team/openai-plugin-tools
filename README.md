# OpenAI Plugin Tools

Public, universal OpenAI plugins published by [ASTUDIO](https://www.astudio.agency/).

## Products

- **PDF Table to Excel** converts selectable PDF tables into clean XLSX workbooks through a remote MCP server.
- **GCC Arabic Writer** provides market-aware Arabic writing guidance for the UAE, Saudi Arabia, Kuwait, Qatar, Bahrain, Oman and pan-Arab audiences.
- **Ad Creative Lab** guides a human-approved, text-only ad brief, concept comparison, deterministic validation and local export workflow.
- **Growth Marketing Planner** guides a user through brief confirmation, exactly three strategy options, selection, revision and 30, 60 or 90-day plan export.

No product contains client data, private corpora, credentials or internal ASTUDIO procedures.
- **AI Crawler Readiness Auditor** checks one public HTTPS page and its crawler controls through a human-confirmed MCP Apps flow.

These plugins contain no client data, private corpora, credentials or internal ASTUDIO procedures.
- **Open Data Fetcher** lets people search approved official catalogs, select a dataset, review rights and size, preview bounded rows and confirm a temporary export.

- **Editable Diagram Builder** creates human-reviewed flowcharts, architecture diagrams, sequence diagrams and concept maps with native editable downloads.

No plugin contains client data, private corpora, credentials or internal ASTUDIO procedures.

## Public pages

- Product site: `https://www.astudio.agency/tools/`
- Privacy: `https://www.astudio.agency/tools/privacy`
- Support: `https://www.astudio.agency/tools/support`
- Terms: `https://www.astudio.agency/tools/terms`

## Development

```bash
python3 tests/validate_packages.py
python3 tests/audit_public_content.py
python3 tests/build_archives.py
npm --prefix pdf-table-to-excel test
npm --prefix gcc-arabic-writer test
npm --prefix ad-creative-lab test
npm --prefix growth-marketing-planner test
npm --prefix ai-crawler-readiness-auditor test
npm --prefix open-data-fetcher test
CHECKPOINT_SECRET=local-development-secret-at-least-32-bytes npm --prefix editable-diagram-builder test
```

## License

MIT
