#!/usr/bin/env python3
"""Build minimal public submission ZIPs with manifests at archive root."""

from __future__ import annotations

import struct
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
PRODUCTS = {
    "ad-creative-lab": {
        "archive": "ad-creative-lab-1.0.0-submission.zip",
        "root_files": {"plugin.json", "mcp.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md"},
        "directories": {"assets", "skills", "review"},
    "ai-crawler-readiness-auditor": {
        "archive": "ai-crawler-readiness-auditor-1.0.0-submission.zip",
        "root_files": {"plugin.json", "mcp.json"},
        "directories": {"assets", "skills"},
    },
    },
    "gcc-arabic-writer": {
        "archive": "gcc-arabic-writer-1.1.0-submission.zip",
        "root_files": {"plugin.json", "mcp.json"},
        "directories": {"assets", "skills", "review"},
    },
    "pdf-table-to-excel": {
        "archive": "pdf-table-to-excel-1.1.0-submission.zip",
        "root_files": {"plugin.json", "mcp.json"},
        "directories": {"assets", "skills"},
    },
    "growth-marketing-planner": {
        "archive": "growth-marketing-planner-1.0.0-submission.zip",
        "root_files": {"plugin.json", "mcp.json", "NOTICE"},
        "directories": {"assets", "skills", "LICENSES"},
    "open-data-fetcher": {
        "archive": "open-data-fetcher-1.0.0-submission.zip",
        "root_files": {"plugin.json", "mcp.json"},
        "directories": {"assets", "skills"},
    },
    "editable-diagram-builder": {
        "archive": "editable-diagram-builder-1.0.0-submission.zip",
        "root_files": {"plugin.json", "mcp.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"},
        "directories": {"assets", "skills", "review"},
    },
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
            if product == "growth-marketing-planner":
                required = {"NOTICE", "LICENSES/corey-haines-marketingskills-MIT.txt", "skills/growth-marketing-planner/SKILL.md", "assets/icon.png", "assets/logo.png"}
                missing = required.difference(names)
                if missing:
                    raise SystemExit(f"growth planner archive missing required attribution or package files: {sorted(missing)}")
            if any("__MACOSX" in name or "/._" in name or "__pycache__" in name for name in names):
                raise SystemExit(f"unclean archive: {target}")
            for name in names:
                if not included(Path(name), spec):
                    raise SystemExit(f"unexpected archive file: {target}:{name}")
                source_bytes = (source / name).read_bytes()
                if archive.read(name) != source_bytes:
                    raise SystemExit(f"source-to-archive mismatch: {target}:{name}")
                if b"/Users/" in source_bytes or b"/home/" in source_bytes:
                    raise SystemExit(f"local path in archive: {target}:{name}")
                if name.lower().endswith(".png"):
                    if len(source_bytes) > 5 * 1024 * 1024 or source_bytes[:8] != b"\x89PNG\r\n\x1a\n":
                        raise SystemExit(f"invalid PNG asset: {target}:{name}")
                    width, height = struct.unpack(">II", source_bytes[16:24])
                    if width != height or width < 48:
                        raise SystemExit(f"icon must be square and at least 48 pixels: {target}:{name}")
            print(f"{target.name}: {len(names)} files, {target.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
