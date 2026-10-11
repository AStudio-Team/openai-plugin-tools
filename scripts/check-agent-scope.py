#!/usr/bin/env python3
"""Validate task branch naming and ensure changed files belong to a declared scope."""

from __future__ import annotations

import argparse
import fnmatch
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--branch", required=True)
    parser.add_argument("--base", default="origin/main")
    args = parser.parse_args()
    config = json.loads((ROOT / ".github" / "agent-scopes.json").read_text())
    prefix = args.branch.split("/", 1)[0]
    if prefix not in config["allowed_branch_prefixes"]:
        raise SystemExit(f"branch prefix not allowed: {args.branch}")
    committed = subprocess.check_output(["git", "diff", "--name-only", f"{args.base}...HEAD"], cwd=ROOT, text=True)
    staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT, text=True)
    changed = sorted({line for line in (committed + "\n" + staged).splitlines() if line})
    patterns = [pattern for scope in config["scopes"].values() for pattern in scope["paths"]]
    unmatched = [name for name in changed if not any(fnmatch.fnmatch(name, pattern) for pattern in patterns)]
    if unmatched:
        raise SystemExit("paths outside declared scopes:\n" + "\n".join(unmatched))
    print(f"scope guard passed for {len(changed)} changed files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
