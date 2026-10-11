---
name: pdf-table-to-excel
description: "Use when the user explicitly asks to convert or extract selectable tables from an attached PDF into an Excel XLSX workbook."
---

# PDF Table to Excel

Use the `convert_pdf_tables_to_excel` tool when the user explicitly asks to convert tables in a PDF to Excel.

## Workflow

1. Confirm that the user supplied or selected a PDF.
2. Invoke the tool with that file.
3. Return the workbook download link and state how many tables and pages were processed.
4. Remind the user that the link expires after 15 minutes.

## Limits

- Maximum PDF size: 20 MB.
- Maximum pages: 200.
- Selectable text tables only.
- OCR for scanned image-only PDFs is not included.
- Formula-like PDF text is written as safe text, not executable spreadsheet formulas.

If the request is unrelated to PDF table extraction, do not invoke the tool.
