# PDF Table to Excel

A narrow, universal OpenAI plugin prototype that converts selectable tables in PDF files into XLSX workbooks for any user or organization.

## Local verification

```bash
scripts/start-local.sh
```

The launcher creates an isolated `.venv`, installs the complete hashed dependency lock, and starts the local MCP server.

Run tests with:

```bash
python3 -m unittest discover -s tests -v
```

## Current limits

- Maximum decoded PDF size: 20 MB.
- Selectable text tables only. OCR is not included in version 0.1.0.
- Local prototype input is base64 PDF bytes.
- Public hosting and ChatGPT file-library UI remain publication-phase work.

## External gates

Public deployment, DNS, privacy and terms pages, developer identity verification, portal registration, submission and publication require fresh approval.
