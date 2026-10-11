#!/usr/bin/env python3
"""Validate local OpenAI plugin package structure."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    raise SystemExit(message)


def validate_manifest(path: Path) -> None:
    data = json.loads(path.read_text())
    if data.get("$schema") != "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json":
        fail(f"bad schema: {path}")
    for key in ("name", "version", "description"):
        if not data.get(key):
            fail(f"missing {key}: {path}")
    interface = data.get("extensions", {}).get("com.openai", {}).get("interface", {})
    for key in ("displayName", "shortDescription", "longDescription", "developerName", "category"):
        if not interface.get(key):
            fail(f"missing interface.{key}: {path}")
    for key in ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"):
        if not str(interface.get(key, "")).startswith("https://"):
            fail(f"missing secure interface.{key}: {path}")
    if not data.get("keywords"):
        fail(f"missing keywords: {path}")
    if len(interface["displayName"]) > 30:
        fail(f"displayName too long: {path}")
    if len(interface["shortDescription"]) > 30:
        fail(f"shortDescription too long: {path}")
    review = data.get("extensions", {}).get("com.openai", {}).get("review")
    if review:
        cases = review.get("test_cases", {})
        positive = cases.get("positive", [])
        negative = cases.get("negative", [])
        if len(positive) != 5 or len(negative) != 3:
            fail(f"review cases must contain exactly 5 positive and 3 negative cases: {path}")
        for case in positive:
            if not all(case.get(key) for key in ("description", "prompt", "tools_triggered", "expected_behavior")):
                fail(f"incomplete positive review case: {path}")
        for case in negative:
            if not case.get("prompt") or "should" not in str(case.get("description", "")).lower():
                fail(f"incomplete negative review case: {path}")
        if not review.get("demo_recording_url"):
            fail(f"missing demo recording URL: {path}")


def validate_skill(path: Path) -> None:
    text = path.read_text()
    if not text.startswith("---\n"):
        fail(f"missing frontmatter: {path}")
    if not re.search(r"^name:\s*\S+", text, re.M):
        fail(f"missing skill name: {path}")
    if not re.search(r"^description:\s*", text, re.M):
        fail(f"missing skill description: {path}")


def main() -> int:
    manifests = list(ROOT.glob("*/plugin.json"))
    if len(manifests) != 2:
        fail(f"expected 2 manifests, found {len(manifests)}")
    for manifest in manifests:
        validate_manifest(manifest)
    skills = list(ROOT.glob("*/skills/*/SKILL.md"))
    if len(skills) != 2:
        fail(f"expected 2 packaged skills, found {len(skills)}")
    for skill in skills:
        validate_skill(skill)
    for path in ROOT.rglob("*"):
        if any(part in {"node_modules", ".venv", ".git", "__pycache__", "build"} for part in path.parts):
            continue
        if path.is_file() and path.suffix.lower() in {".md", ".json", ".py", ".mjs", ".html", ".css", ".sh", ".yml", ".yaml"}:
            if chr(0x2014) in path.read_text(errors="ignore"):
                fail(f"em dash found: {path}")
    print("package validation passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
