# PDF Table to Excel

A public OpenAI plugin that converts selectable tables in PDF files into downloadable XLSX workbooks for any user or organization.

## Local verification

```bash
python3.11 -m venv .venv
.venv/bin/pip install --require-hashes -r requirements-dev.lock
npm ci --ignore-scripts
PATH="$PWD/.venv/bin:$PATH" npm test
npm audit --audit-level=high
```

## Current limits

- Maximum decoded PDF size: 20 MB.
- Selectable text tables only. OCR is not included.
- One user-selected PDF per tool call.
- Generated workbooks remain in memory for no more than 15 minutes and are removed by periodic expiration cleanup.

## External gates

Public deployment changes, developer identity verification, portal registration, submission and publication require fresh approval.
