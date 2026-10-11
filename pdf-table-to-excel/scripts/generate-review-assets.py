#!/usr/bin/env python3
"""Generate synthetic OpenAI review PDFs, expected XLSX files, and demo video."""

from __future__ import annotations

import io
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import PageBreak, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "review"
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))
from convert_pdf import convert_pdf_bytes  # noqa: E402

DATASETS = {
    "invoice": [
        [["Item", "Quantity", "Unit price", "Total"], ["Strategy session", "2", "500.00", "1000.00"], ["Production day", "1", "2500.00", "2500.00"]],
    ],
    "report": [
        [["Quarter", "Revenue", "Growth"], ["Q1", "120000", "8%"], ["Q2", "138000", "15%"]],
        [["Market", "Leads", "Conversion"], ["UAE", "240", "12%"], ["Saudi Arabia", "190", "10%"]],
    ],
    "schedule": [
        [["Time", "Session", "Room"], ["09:00", "Opening keynote", "Main hall"], ["11:00", "AI workshop", "Studio 2"], ["14:30", "Creative review", "Studio 1"]],
    ],
    "price-list": [
        [["Product", "SKU", "Price", "Available"], ["Discovery set", "DS-01", "120", "Yes"], ["Signature bottle", "SB-50", "480", "Yes"], ["Limited edition", "LE-75", "750", "No"]],
    ],
    "formula-safety": [
        [["Reference", "Imported value"], ["Example 1", '=HYPERLINK("https://example.com","click")'], ["Example 2", "+1+1"], ["Example 3", "@SUM(A1:A2)"]],
    ],
}


def make_pdf(table_groups: list[list[list[str]]]) -> bytes:
    output = io.BytesIO()
    doc = SimpleDocTemplate(output, pagesize=A4, title="Synthetic plugin review fixture")
    story = []
    for index, rows in enumerate(table_groups):
        table = Table(rows, repeatRows=1)
        table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.8, colors.HexColor("#322625")),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#C0E3E5")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
            ("TOPPADDING", (0, 0), (-1, 0), 8),
        ]))
        story.append(table)
        if index < len(table_groups) - 1:
            story.extend([Spacer(1, 32), PageBreak()])
    doc.build(story)
    return output.getvalue()


def font(size: int, bold: bool = False):
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)


def slide(title: str, body: list[str], number: str) -> Image.Image:
    image = Image.new("RGB", (1600, 900), "#F8F5EF")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((80, 70, 220, 92), radius=11, fill="#FEC933")
    draw.text((80, 126), number, font=font(22, True), fill="#6C625F")
    draw.multiline_text((80, 182), title, font=font(72, True), fill="#322625", spacing=4)
    y = 440
    for line in body:
        draw.ellipse((86, y + 13, 100, y + 27), fill="#C0E3E5")
        draw.text((125, y), line, font=font(30), fill="#4F4542")
        y += 72
    draw.text((80, 820), "PDF Table to Excel by ASTUDIO", font=font(22, True), fill="#322625")
    draw.text((1110, 820), "astudio.agency/tools", font=font(22), fill="#6C625F")
    return image


def main() -> int:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for name, tables in DATASETS.items():
        pdf = make_pdf(tables)
        (PUBLIC / f"sample-{name}.pdf").write_bytes(pdf)
        xlsx, _ = convert_pdf_bytes(pdf)
        (PUBLIC / f"expected-{name}.xlsx").write_bytes(xlsx)

    frames = [
        slide("PDF Table\nto Excel", ["A focused ChatGPT and Codex plugin", "Text-based PDF tables become clean XLSX workbooks"], "01"),
        slide("1. Attach\na PDF", ["Choose a PDF from ChatGPT", "Maximum size: 20 MB", "Selectable text tables only"], "02"),
        slide("2. Ask for\nconversion", ["Convert every table in this PDF to Excel", "The plugin reads only the selected file", "Each table gets its own worksheet"], "03"),
        slide("3. Review\nthe result", ["A summary sheet lists pages and tables", "Formula-like text is neutralized", "No OCR or invented table values"], "04"),
        slide("4. Download\nthe workbook", ["The XLSX link expires after 15 minutes", "Inputs are not intentionally retained", "Run again if the link expires"], "05"),
        slide("Ready for\nreal work", ["Invoices, reports, schedules and price lists", "Clear limits and predictable errors", "No account or advertising"], "06"),
    ]
    with tempfile.TemporaryDirectory(prefix="pdf-plugin-demo-") as temporary:
        frame_dir = Path(temporary)
        for index, image in enumerate(frames, start=1):
            image.save(frame_dir / f"frame-{index:02d}.png")
        subprocess.run([
            "ffmpeg", "-y", "-framerate", "1/4", "-i", str(frame_dir / "frame-%02d.png"),
            "-c:v", "libx264", "-r", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            str(PUBLIC / "pdf-table-to-excel-demo.mp4"),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"generated review assets in {PUBLIC}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
