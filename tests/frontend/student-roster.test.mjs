import assert from "node:assert/strict";
import test from "node:test";
import { planProvisioning, temporaryPassword, usernameProblem, validateRoster } from "../../scripts/lib/student-roster.mjs";

const header = "roster_ref,email,username,eligible";
const domain = { emailDomains: ["university.example"] };

test("a valid roster yields eligible rows only", () => {
  const result = validateRoster(`${header}\nREF-001,a.one@university.example,blue-falcon,yes\nREF-002,b.two@university.example,red-maple,no\n`, domain);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, [{ line: 2, email: "a.one@university.example", username: "blue-falcon" }]);
});

test("duplicates, unapproved domains, identifying usernames, and unsafe text are rejected with line numbers only", () => {
  const roster = [
    header,
    "REF-001,a.one@university.example,blue-falcon,yes",
    "REF-001,c.three@university.example,green-oak,yes",
    "REF-004,a.one@university.example,amber-sky,yes",
    "REF-005,e.five@university.example,blue-falcon,yes",
    "REF-006,f.six@gmail.com,calm-lake,yes",
    "REF-007,g.seven@university.example,g.seven,yes",
    "REF-008,h.eight@university.example,student20231234,yes",
    "REF-009,i.nine@university.example,x-ref-009,yes",
    "REF-010,j.ten@university.example,=cmd,yes",
    "REF-011,k.eleven@university.example,admin,yes",
    "REF-012,l.twelve@university.example,new-star,maybe",
  ].join("\n");
  const result = validateRoster(roster, domain);
  assert.equal(result.ok, false);
  assert.deepEqual(result.rows, [], "nothing is provisioned from a rejected roster");
  const reasons = result.errors.map((error) => `${error.line}:${error.reason}`).join("\n");
  for (const expected of ["3:duplicate roster_ref", "4:duplicate email", "5:duplicate username", "6:email domain is not approved",
    "7:username must not be derived from the email", "8:username must not contain long digit runs", "9:username must not contain the roster reference",
    "10:quotes, markup", "11:username is reserved", "12:eligible must be yes or no"]) {
    assert.match(reasons, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")), expected);
  }
  assert.doesNotMatch(reasons, /university\.example|REF-0/u, "errors never echo roster contents");
});

test("fictional .test identities require the explicit fictional mode and vice versa", () => {
  const fictional = `${header}\nFX-001,fx.one@academic-arena.test,blue-falcon,yes`;
  assert.equal(validateRoster(fictional, { emailDomains: ["academic-arena.test"] }).ok, false);
  assert.equal(validateRoster(fictional, { emailDomains: ["academic-arena.test"], fictional: true }).ok, true);
  assert.equal(validateRoster(`${header}\nREF-001,a.one@university.example,blue-falcon,yes`, { emailDomains: ["university.example"], fictional: true }).ok, false);
  assert.equal(validateRoster(fictional, { emailDomains: [] }).ok, false);
});

test("temporary passwords are long, varied, and unique", () => {
  const values = new Set(Array.from({ length: 500 }, () => temporaryPassword()));
  assert.equal(values.size, 500);
  for (const value of values) assert.match(value, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-HJ-NP-Za-km-z2-9]{20}$/u);
});

test("username rules block names that reveal identity", () => {
  assert.equal(usernameProblem("quiet-river", { rosterRef: "REF-1", email: "m.k@university.example" }), null);
  assert.ok(usernameProblem("Quiet", { rosterRef: "x", email: "y@z.example" }));
});

test("planning resumes idempotently and never re-creates or silently adopts accounts", () => {
  const rows = [
    { line: 2, email: "a@u.example", username: "alpha-one" },
    { line: 3, email: "b@u.example", username: "bravo-two" },
    { line: 4, email: "c@u.example", username: "charlie-three" },
    { line: 5, email: "d@u.example", username: "delta-four" },
    { line: 6, email: "e@u.example", username: "echo-five" },
    { line: 7, email: "f@u.example", username: "taken-name" },
    { line: 8, email: "g@u.example", username: "golf-seven" },
    { line: 9, email: "h@u.example", username: "hotel-eight" },
  ];
  const state = [
    { provider_email: "a@u.example", auth_user_id: "1", account_username: "alpha-one" },
    { provider_email: "b@u.example", auth_user_id: "2", account_username: "someone-else" },
    { provider_email: "c@u.example", auth_user_id: "3", auth_confirmed: true, auth_created_by_tool: true, auth_has_signed_in: false },
    { provider_email: "d@u.example", auth_user_id: "4", auth_confirmed: true, auth_created_by_tool: false, auth_has_signed_in: false },
    { provider_email: "g@u.example", auth_user_id: "7", auth_confirmed: true, auth_created_by_tool: true, auth_user_mapped: true },
    { provider_email: "h@u.example", auth_user_id: "8", auth_confirmed: true, auth_created_by_tool: true, auth_has_mfa: true },
  ];
  const plan = planProvisioning(rows, state, ["taken-name"]);
  assert.deepEqual(plan.map((item) => item.action), ["done", "conflict", "orphan", "orphan", "create", "conflict", "conflict", "orphan"]);
  const adopting = planProvisioning(rows, state, ["taken-name"], { adoptOrphans: true });
  assert.deepEqual(adopting.map((item) => item.action), ["done", "conflict", "adopt", "orphan", "create", "conflict", "conflict", "orphan"],
    "only unmapped, tool-created, never-signed-in provider users without MFA are adopted");
});
