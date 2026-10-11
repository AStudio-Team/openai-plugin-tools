#!/usr/bin/env python3
"""Fail if distributable plugin files contain private or machine-specific material."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOTS = [ROOT / "pdf-table-to-excel", ROOT / "gcc-arabic-writer", ROOT / "open-data-fetcher"]
TEXT_SUFFIXES = {".md", ".json", ".py", ".mjs", ".html", ".css", ".sh", ".yml", ".yaml", ".txt", ".lock"}
SKIP_PARTS = {"node_modules", ".venv", ".git", "__pycache__", "build"}
FORBIDDEN = {
    "local user path": re.compile(r"/Users/|/home/|[A-Za-z]:\\\\Users\\\\"),
    "airtable identifier": re.compile(r"\bapp(?=[A-Za-z0-9]{14}\b)(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{14}\b"),
    "api token shape": re.compile(r"\b(?:sk-|xox[baprs]-|pat[A-Za-z0-9_-]{8,})[A-Za-z0-9_-]{12,}\b"),
    "private key": re.compile(r"BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY"),
    "secret assignment": re.compile(r"(?i)\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
    "private base id": re.compile(r"\b(?:tbl|fld|rec)(?=[A-Za-z0-9]{14}\b)(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{14}\b"),
}


def main() -> int:
    findings = []
    for root in PACKAGE_ROOTS:
        for path in root.rglob("*"):
            if any(part in SKIP_PARTS for part in path.parts) or not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            text = path.read_text(errors="ignore")
            for label, pattern in FORBIDDEN.items():
                if pattern.search(text):
                    findings.append(f"{label}: {path.relative_to(ROOT)}")
    if findings:
        raise SystemExit("\n".join(findings))
    print("public confidentiality audit passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
