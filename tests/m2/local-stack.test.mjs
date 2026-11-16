import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import test from "node:test";

const url = process.env.AA_SUPABASE_URL;
const anonKey = process.env.AA_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.AA_SUPABASE_SERVICE_ROLE_KEY;

test("local Supabase Auth endpoint is bound to loopback", () => {
  assert.ok(url, "run this test through npm run test:m2:local");
  assert.ok(["127.0.0.1", "[::1]"].includes(new URL(url).hostname));
});

test("local Supabase API and database listeners are loopback-only", () => {
  assert.ok(url, "run this test through npm run test:m2:local");
  const dbUrl = process.env.AA_SUPABASE_DB_URL;
  assert.ok(dbUrl, "local database URL must be supplied only to the test process");
  const ports = new Set([new URL(url).port, new URL(dbUrl).port]);
  const output = os.platform() === "darwin"
    ? execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" })
    : execFileSync("ss", ["-ltnH"], { encoding: "utf8" });
  const found = new Map([...ports].map((port) => [port, []]));
  for (const line of output.split(/\r?\n/)) {
    let address;
    let port;
    if (os.platform() === "darwin") {
      const match = line.match(/\bTCP\s+(\S+):(\d+)\s+\(LISTEN\)/);
      if (match) [, address, port] = match;
    } else {
      const columns = line.trim().split(/\s+/);
      const endpoint = columns[3] || "";
      const separator = endpoint.lastIndexOf(":");
      if (separator > -1) {
        address = endpoint.slice(0, separator);
        port = endpoint.slice(separator + 1);
      }
    }
    if (found.has(port)) found.get(port).push(address);
  }
  for (const [port, addresses] of found) {
    assert.ok(addresses.length > 0, `expected a listening service on port ${port}`);
    assert.ok(addresses.every((address) => ["127.0.0.1", "[::1]", "::1"].includes(address)),
      `service on port ${port} must not listen on a wildcard or external address: ${addresses.join(", ")}`);
  }
});

test("Supabase Auth rejects public email registration", async () => {
  assert.ok(url, "run this test through npm run test:m2:local");
  assert.ok(anonKey, "local anonymous key must be supplied only to the test process");
  const response = await fetch(new URL("/auth/v1/signup", url), {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: `signup-disabled-${crypto.randomUUID()}@academic-arena.test`,
      password: `${crypto.randomUUID()}Aa!`,
    }),
  });
  assert.ok(response.status >= 400 && response.status < 500,
    `public sign-up must be rejected; got HTTP ${response.status}`);
});

test("local provider accepts a reserved .test fixture and returns email and tokens only to server-side test code", async (context) => {
  assert.ok(url, "run this test through npm run test:m2:local");
  assert.ok(anonKey && serviceRoleKey, "local test keys must remain in the test process");
  const email = `fixture-${crypto.randomUUID()}@academic-arena.test`;
  const password = `${crypto.randomUUID()}Aa!`;
  const adminHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const create = await fetch(new URL("/auth/v1/admin/users", url), {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  assert.ok(create.ok, `local admin user creation failed with HTTP ${create.status}`);
  const user = await create.json();
  assert.equal(typeof user.email_confirmed_at, "string");
  assert.ok(user.email.endsWith("@academic-arena.test"));
  context.after(async () => {
    if (user.id) {
      const deleted = await fetch(new URL(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, url), {
        method: "DELETE",
        headers: adminHeaders,
      });
      assert.ok(deleted.ok, `local test identity cleanup failed with HTTP ${deleted.status}`);
    }
  });

  const login = await fetch(new URL("/auth/v1/token?grant_type=password", url), {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await login.json();
  const errorDescription = Object.values(loginBody).filter((value) => typeof value === "string").join(" ");
  const errorTags = ["invalid", "confirm", "email", "password", "rate", "limit", "disabled"]
    .filter((tag) => errorDescription.toLowerCase().includes(tag)).join("+") || "none";
  const safeCode = [loginBody.code, loginBody.error_code]
    .filter((value) => typeof value === "string" && /^[a-z0-9_-]{1,48}$/i.test(value)).join("/") || "none";
  const failureCategory = /not confirmed/i.test(errorDescription)
    ? "email_not_confirmed"
    : /invalid/i.test(errorDescription) ? "invalid_credentials"
      : /password/i.test(errorDescription) ? "password_error"
        : /email/i.test(errorDescription) ? "email_error" : "provider_error";
  assert.ok(login.ok, `fictional local password login failed with HTTP ${login.status} (${failureCategory}; code=${safeCode}; fields=${Object.keys(loginBody).sort().join(",")}; tags=${errorTags})`);
  const providerSession = loginBody;
  assert.equal(typeof providerSession.access_token, "string");
  assert.equal(typeof providerSession.refresh_token, "string");
  assert.equal(providerSession.user.email, email);
});
