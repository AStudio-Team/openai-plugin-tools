---
name: pdf-table-to-excel
description: "Use when the user asks to convert or extract tables from an attached PDF (invoice, bank statement, report, price list, schedule, catalogue) into an Excel XLSX workbook or spreadsheet. Do not use for scanned image-only PDFs, Word or image files, or PDFs without tables."
version: 1.1.0
---

# PDF Table to Excel

Use the `convert_pdf_tables_to_excel` tool when the user explicitly asks to convert tables in a PDF to Excel.

## Workflow

1. Confirm that the user supplied or selected a PDF.
2. Invoke the tool with that file.
3. Return the result preview and plain-text fallback with the filename, pages, table count, worksheets, sample rows and verified temporary download URL.
4. Use the widget's host-mediated download when available. Otherwise provide the URL in chat.
5. Remind the user that the link expires after 15 minutes and offer to rename, inspect a worksheet or convert another uploaded PDF. Do not present the preview as an editable spreadsheet.

## Limits

- Maximum PDF size: 20 MB.
- Maximum pages: 200.
- Selectable text tables only.
- OCR for scanned image-only PDFs is not included.
- Formula-like PDF text is written as safe text, not executable spreadsheet formulas.

If the request is unrelated to PDF table extraction, do not invoke the tool.
