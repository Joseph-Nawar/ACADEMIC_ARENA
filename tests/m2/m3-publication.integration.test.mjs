import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { api, json } from "./bff-fixtures.mjs";
import { call, staffSession, studentSession } from "./m3-helpers.mjs";

// Fictional level-only rankings (level,rank,public_name).
const example = await readFile(new URL("../../data/ranking-upload.example.csv", import.meta.url), "utf8");
const renamed = example.replace(/^4,1,[^\n]+$/mu, "4,1,Zara Fictional-Updated");

async function board(level) {
  const response = await api(`/api/public/leaderboards?level=${level}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/u, "public rankings are never cached");
  return json(response);
}

test("level-only publication: validation, preview, atomic publish, concurrency, rollback, and withdrawal", async (context) => {
  const publisher = await staffSession(context, "lvl-publisher", "publisher");
  const student = await studentSession(context, "lvl-student");
  const unverified = await staffSession(context, "lvl-publisher-aal1", "publisher", { mfa: false });
  const upload = (session, csv, { releaseLabel = "Week 5", headers } = {}) => call(session, "/api/staff/leaderboards/drafts", {
    method: "POST", body: { academicYear: "2026-27", releaseLabel, csv }, headers,
  });
  const publish = (id) => call(publisher, "/api/staff/leaderboards/publish", { method: "POST", body: { publicationId: id } });

  assert.equal((await call(null, "/api/staff/leaderboards/history")).status, 401, "anonymous history is refused");
  assert.equal((await call(student, "/api/staff/leaderboards/history")).status, 403, "students cannot see publication history");
  assert.equal((await upload(student, example)).status, 403, "students cannot upload rankings");
  assert.equal((await upload(unverified, example)).status, 403, "publisher without MFA step-up cannot upload");
  assert.equal((await upload(publisher, example, { headers: { "X-CSRF-Token": "x".repeat(43) } })).status, 403, "CSRF token is required");
  const crossSite = await api("/api/staff/leaderboards/drafts", {
    method: "POST", origin: "https://evil.example", headers: { Cookie: publisher.cookie, "X-CSRF-Token": publisher.csrfToken },
    body: { academicYear: "2026-27", releaseLabel: "Week 5", csv: example },
  });
  assert.equal(crossSite.status, 403, "cross-origin upload is refused");

  for (const [label, csv] of [
    ["extra metric column", example.replace("level,rank,public_name", "level,rank,public_name,quiz_total").replace(/\n(?=\d)/gu, ",9\n")],
    ["29 rows", example.split("\n").slice(0, 30).join("\n")],
    ["duplicate rank", example.replace(/^4,2,/mu, "4,1,")],
    ["markup", example.replace(/^5,3,[^\n]+$/mu, "5,3,<img src=x onerror=alert(1)>")],
    ["legacy format", "level,semester,cohort_key\n5,1,core"],
  ]) {
    assert.equal((await upload(publisher, csv)).status, 422, `${label} is rejected`);
  }
  assert.equal((await upload(publisher, example, { releaseLabel: "<b>Week</b>" })).status, 400, "release label is validated");
  for (const level of [4, 5, 6]) assert.deepEqual((await board(level)).rows, [], "nothing is public after rejected uploads");

  const first = await json(await upload(publisher, example));
  assert.equal(first.draft.rowCount, 30);
  assert.deepEqual(first.diff.levels.map((item) => item.changes.filter((change) => change.change === "added").length), [10, 10, 10],
    "preview lists every added name by level and rank");
  assert.deepEqual((await board(4)).rows, [], "a draft is not public");
  assert.equal((await call(student, "/api/staff/leaderboards/publish", { method: "POST", body: { publicationId: first.draft.id } })).status, 403,
    "students cannot publish");
  assert.equal((await publish(first.draft.id)).status, 200);

  const expected = example.trim().split("\n").slice(1).map((line) => line.split(","));
  for (const level of [4, 5, 6]) {
    const live = await board(level);
    assert.equal(live.releaseLabel, "Week 5");
    assert.match(live.publishedAt, /^\d{4}-\d{2}-\d{2}$/u);
    assert.deepEqual(live.rows.map((row) => row.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(live.rows.map((row) => row.name), expected.filter((row) => row[0] === String(level)).map((row) => row[2]),
      `Level ${level} keeps the uploaded order and spelling`);
    for (const row of live.rows) assert.deepEqual(Object.keys(row).sort(), ["avatar", "name", "position", "style"]);
  }
  assert.equal((await api("/api/public/leaderboards?level=7")).status, 400, "unknown level is rejected");
  assert.equal((await api("/api/public/leaderboards?level=4&semester=1")).status, 400, "legacy filters are rejected");

  const second = await json(await upload(publisher, renamed, { releaseLabel: "Week 6" }));
  assert.deepEqual(second.diff.levels[0].changes.map((change) => [change.position, change.change]), [[1, "changed"]],
    "preview shows only the changed rank");
  assert.equal((await publish(second.draft.id)).status, 200);
  assert.equal((await board(4)).rows[0].name, "Zara Fictional-Updated");
  assert.equal((await board(5)).releaseLabel, "Week 6", "all levels switch version together");

  const concurrent = await Promise.all([publish(first.draft.id), publish(second.draft.id), publish(first.draft.id)]);
  assert.ok(concurrent.every((response) => response.status === 200), "concurrent publications serialize");
  const history = await json(await call(publisher, "/api/staff/leaderboards/history"));
  assert.equal(history.publications.filter((item) => item.state === "live").length, 1, "exactly one publication is live");

  assert.equal((await publish(first.draft.id)).status, 200, "rollback to version 1");
  assert.equal((await board(6)).releaseLabel, "Week 5", "rollback restores every level");
  assert.equal((await board(4)).rows[0].name, expected[0][2]);

  assert.deepEqual(await json(await call(publisher, "/api/staff/leaderboards/withdraw", { method: "POST", body: {} })), { withdrawn: true });
  for (const level of [4, 5, 6]) assert.deepEqual((await board(level)).rows, [], "withdrawn rankings disappear immediately");
});
