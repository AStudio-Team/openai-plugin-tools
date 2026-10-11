#!/usr/bin/env python3
"""Build minimal public submission ZIPs with manifests at archive root."""

from __future__ import annotations

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
PRODUCTS = {
    "ad-creative-lab": {
        "archive": "ad-creative-lab-1.0.0-submission.zip",
        "root_files": {"plugin.json", "mcp.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md"},
        "directories": {"assets", "skills", "review"},
    },
    "gcc-arabic-writer": {
        "archive": "gcc-arabic-writer-1.0.0-submission.zip",
        "root_files": {"plugin.json", "mcp.json"},
        "directories": {"assets", "skills", "review"},
    },
    "pdf-table-to-excel": {
        "archive": "pdf-table-to-excel-1.0.0-submission.zip",
        "root_files": {"plugin.json", "mcp.json"},
        "directories": {"assets", "skills"},
    },
}
SKIP_PARTS = {"__pycache__", "__MACOSX", ".pytest_cache", ".git", ".venv", "node_modules"}


def included(relative: Path, spec: dict) -> bool:
    if len(relative.parts) == 1:
        return relative.name in spec["root_files"]
    return relative.parts[0] in spec["directories"]


def main() -> int:
    BUILD.mkdir(exist_ok=True)
    for product, spec in PRODUCTS.items():
        source = ROOT / product
        target = BUILD / spec["archive"]
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(source.rglob("*")):
                relative = path.relative_to(source)
                if not path.is_file() or not included(relative, spec):
                    continue
                if any(part in SKIP_PARTS for part in path.parts) or path.name == ".DS_Store" or path.name.startswith("._"):
                    continue
                archive.write(path, relative)
        with zipfile.ZipFile(target) as archive:
            names = archive.namelist()
            if "plugin.json" not in names or any(name.startswith(f"{product}/") for name in names):
                raise SystemExit(f"invalid archive root: {target}")
            if any("__MACOSX" in name or "/._" in name or "__pycache__" in name for name in names):
                raise SystemExit(f"unclean archive: {target}")
            print(f"{target.name}: {len(names)} files, {target.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
