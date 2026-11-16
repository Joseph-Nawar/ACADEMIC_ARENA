#!/usr/bin/env python3
"""Report likely committed secrets by path and line without echoing values."""

import argparse
import base64
import json
import re
import sys
from pathlib import Path


SECRET_PATTERNS = (
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("github-token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b")),
    ("supabase-secret", re.compile(r"\bsb_secret_[A-Za-z0-9_-]{16,}\b")),
    (
        "service-key-assignment",
        re.compile(
            r"(?i)\b(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|CF_API_TOKEN|CLOUDFLARE_API_TOKEN)"
            r"\s*[:=]\s*[\"']?([A-Za-z0-9._~+/-]{20,})[\"']?"
        ),
    ),
)
JWT_PATTERN = re.compile(r"\b(eyJ[A-Za-z0-9_-]{10,})\.([A-Za-z0-9_-]{10,})\.([A-Za-z0-9_-]{10,})\b")
PUBLIC_PRIVATE_FIELDS = re.compile(
    r"(?i)[\"'](?:student_id|studentid|account_id|accountid|internal_id|email|email_address|"
    r"academic_score|attendance_history|password_hash|access_token|refresh_token|service_role)[\"']\s*:"
)
SKIP_DIRECTORIES = {".git", ".venv", "node_modules", "__pycache__", "test-results", "playwright-report"}


def _placeholder(value):
    return value.lower().startswith(("replace", "your-", "example", "placeholder", "change-me"))


def _jwt_is_service_role(match):
    payload = match.group(2)
    payload += "=" * (-len(payload) % 4)
    try:
        claims = json.loads(base64.urlsafe_b64decode(payload.encode("ascii")))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return False
    return claims.get("role") == "service_role"


def scan(root, public=False):
    root = Path(root).resolve()
    paths = [root] if root.is_file() else sorted(root.rglob("*"))
    findings = []
    for path in paths:
        if not path.is_file() or any(part in SKIP_DIRECTORIES for part in path.relative_to(root if root.is_dir() else root.parent).parts[:-1]):
            continue
        try:
            raw = path.read_bytes()
            if b"\0" in raw[:8192]:
                continue
            content = raw.decode("utf-8")
        except (OSError, UnicodeDecodeError, ValueError):
            continue
        for line_number, line in enumerate(content.splitlines(), 1):
            for label, pattern in SECRET_PATTERNS:
                match = pattern.search(line)
                if match:
                    value = match.group(1) if label == "service-key-assignment" else ""
                    if not value or not _placeholder(value):
                        findings.append((path, line_number, label))
            if any(_jwt_is_service_role(match) for match in JWT_PATTERN.finditer(line)):
                findings.append((path, line_number, "supabase-service-role-jwt"))
            if public and PUBLIC_PRIVATE_FIELDS.search(line):
                findings.append((path, line_number, "private-field-in-public-output"))
    return findings


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".", help="directory or file to scan")
    parser.add_argument("--public", action="store_true", help="also reject private field names in public bundles")
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()
    findings = scan(root, public=args.public)
    for path, line_number, label in findings:
        try:
            display_path = path.relative_to(root if root.is_dir() else root.parent)
        except ValueError:
            display_path = path
        print(f"{display_path}:{line_number}: {label}")
    if findings:
        print(f"Found {len(findings)} security finding(s); matched values were not printed.", file=sys.stderr)
        return 1
    print("Secret scan passed." if not args.public else "Secret and public-field scan passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
