import test from "node:test";
import assert from "node:assert/strict";
import { providerResultIsDefinitive } from "../../functions/lib/provider.js";

test("only definitive provider responses allow a credential-sync claim release", () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429]) {
    assert.equal(providerResultIsDefinitive({ status }), true, `HTTP ${status} is definitive`);
  }
  for (const status of [0, 408, 500, 502, 503, 504, 522, 524]) {
    assert.equal(providerResultIsDefinitive({ status }), false, `HTTP ${status} is ambiguous`);
  }
  for (const error of [null, undefined, {}, { status: "500" }, { status: 200 }, { status: 302 }]) {
    assert.equal(providerResultIsDefinitive(error), false);
  }
});
