#!/usr/bin/env python3
"""Replace or append the top-level synthetic fixture site block."""
from __future__ import annotations
import sys
from pathlib import Path
BEGIN = "# BEGIN AI_CRAWLER_FIXTURES"
END = "# END AI_CRAWLER_FIXTURES"
if len(sys.argv) != 3:
    raise SystemExit("usage: update-fixture-caddy.py CADDYFILE BLOCKFILE")
caddyfile = Path(sys.argv[1])
block = Path(sys.argv[2]).read_text().strip()
text = caddyfile.read_text()
if BEGIN in text:
    before, rest = text.split(BEGIN, 1)
    _, after = rest.split(END, 1)
    updated = before.rstrip() + "\n\n" + block + "\n" + after.lstrip("\n")
else:
    updated = text.rstrip() + "\n\n" + block + "\n"
caddyfile.write_text(updated)
