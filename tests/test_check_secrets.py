import base64
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from scripts.check_secrets import main, scan


def fake_jwt(payload):
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return "eyJhbGciOiJIUzI1NiJ9." + encoded + ".ZmFrZXNpZ25hdHVyZXZhbHVl"


class SecretScanTests(unittest.TestCase):
    def test_private_key_is_reported_by_file_and_line_without_value(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            begin = "-----BEGIN " + "PRIVATE KEY-----"
            key = begin + "\nfictional-test-material\n-----END PRIVATE KEY-----"
            (root / "sample.txt").write_text("safe line\n" + key + "\n", encoding="utf-8")
            output = io.StringIO()
            errors = io.StringIO()
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                self.assertEqual(main(["--root", str(root)]), 1)
            self.assertIn("sample.txt:2: private-key", output.getvalue())
            self.assertNotIn("fictional-test-material", output.getvalue())
            self.assertNotIn("fictional-test-material", errors.getvalue())

    def test_provider_tokens_and_service_role_jwts_are_found(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            token = "ghp_" + "A" * 36
            secret = "sb_secret_" + "b" * 24
            jwt = fake_jwt({"role": "service_role"})
            assignment = 'CF_API_TOKEN="' + "c" * 32 + '"'
            (root / "fixture.txt").write_text(token + "\n" + secret + "\n" + jwt + "\n" + assignment, encoding="utf-8")
            findings = scan(root)
            self.assertEqual({finding[2] for finding in findings}, {
                "github-token", "supabase-secret", "supabase-service-role-jwt", "service-key-assignment"
            })

    def test_explicit_placeholders_do_not_fail_the_scan(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".env.example").write_text(
                'SUPABASE_SERVICE_ROLE_KEY="replace-this-in-local-env"\n', encoding="utf-8"
            )
            self.assertEqual(scan(root), [])

    def test_public_bundle_scan_rejects_private_field_names(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "bundle.json").write_text('{"student_id":"fictional-only"}', encoding="utf-8")
            findings = scan(root, public=True)
            self.assertEqual(findings[0][2], "private-field-in-public-output")


if __name__ == "__main__":
    unittest.main()
