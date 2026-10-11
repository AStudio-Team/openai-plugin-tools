#!/usr/bin/env python3
"""Replace the managed plugin-tools block in the production Caddyfile."""

from __future__ import annotations

import sys
from pathlib import Path

BEGIN = "# BEGIN OPENAI_PLUGIN_TOOLS"
END = "# END OPENAI_PLUGIN_TOOLS"


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: update-caddy.py CADDYFILE BLOCKFILE")
    caddyfile = Path(sys.argv[1])
    block = Path(sys.argv[2]).read_text().strip()
    text = caddyfile.read_text()
    if BEGIN in text:
        before, rest = text.split(BEGIN, 1)
        _, after = rest.split(END, 1)
        updated = before.rstrip() + "\n" + block + "\n" + after.lstrip("\n")
    else:
        needle = "    reverse_proxy nginx-ae-interim:80 {"
        if needle not in text:
            raise SystemExit("main ASTUDIO reverse proxy marker not found")
        updated = text.replace(needle, block + "\n" + needle, 1)
    caddyfile.write_text(updated)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
