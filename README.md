# OpenAI Plugin Tools

Public, universal OpenAI plugins published by [ASTUDIO](https://www.astudio.agency/).

## Products

- **PDF Table to Excel** converts selectable PDF tables into clean XLSX workbooks through a remote MCP server.
- **GCC Arabic Writer** provides market-aware Arabic writing guidance for the UAE, Saudi Arabia, Kuwait, Qatar, Bahrain, Oman and pan-Arab audiences.
- **Verified Buy Link** compares only exact product-page URLs supplied by the user through an explicit market checkpoint and evidence-led human selection.

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
npm --prefix verified-buy-link test
```

## License

MIT
