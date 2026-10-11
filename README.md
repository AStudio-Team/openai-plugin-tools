# OpenAI Plugin Tools

Public, universal OpenAI plugins published by [ASTUDIO](https://www.astudio.agency/).

## Products

- **PDF Table to Excel** converts selectable PDF tables into clean XLSX workbooks through a remote MCP server.
- **GCC Arabic Writer** provides market-aware Arabic writing guidance for the UAE, Saudi Arabia, Kuwait, Qatar, Bahrain, Oman and pan-Arab audiences.
- **AI Crawler Readiness Auditor** checks one public HTTPS page and its crawler controls through a human-confirmed MCP Apps flow.

These plugins contain no client data, private corpora, credentials or internal ASTUDIO procedures.

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
npm --prefix ai-crawler-readiness-auditor test
```

## License

MIT
