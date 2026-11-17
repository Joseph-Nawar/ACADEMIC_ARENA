import test from "node:test";
import assert from "node:assert/strict";
import { passwordUpdateRejectedBeforeWrite } from "../../functions/lib/provider.js";

test("a password-update claim is released only for Auth pre-write error codes", () => {
  for (const [status, code] of [
    [400, "validation_failed"], [400, "bad_json"], [422, "weak_password"], [404, "user_not_found"],
    [429, "over_request_rate_limit"], [401, "no_authorization"], [403, "bad_jwt"], [403, "not_admin"],
  ]) {
    assert.equal(passwordUpdateRejectedBeforeWrite({ status, code }), true, `${status} ${code} is pre-write`);
  }
});

test("ambiguous or unrecognised password-update failures keep the claim held", () => {
  const ambiguous = [
    { status: 0 }, // no response / timeout
    { status: 429 }, // gateway rate limit without an Auth error code
    { status: 403 }, // gateway or WAF response
    { status: 408, code: "request_timeout" },
    { status: 409, code: "conflict" }, // an Auth code not proven to be pre-write
    { status: 500, code: "unexpected_failure" },
    { status: 502 }, { status: 503 }, { status: 504 }, { status: 522 },
    { status: 429, code: 429 },
    null, undefined, {},
  ];
  for (const error of ambiguous) {
    assert.equal(passwordUpdateRejectedBeforeWrite(error), false, JSON.stringify(error ?? null));
  }
});
