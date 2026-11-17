import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { api, json } from "./bff-fixtures.mjs";
import { call, origin, staffSession, studentSession } from "./m3-helpers.mjs";

const example = await readFile(new URL("../../data/ranking-upload.example.csv", import.meta.url), "utf8");
const semesterOnly = example.split("\n").filter((line, index) => index === 0 || line.includes(",semester,")).join("\n");

async function board(query) {
  const response = await api(`/api/public/leaderboards?${new URLSearchParams(query)}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/u, "public rankings are never cached");
  return json(response);
}
const semesterBoard = { level: "5", semester: "1", group: "core", kind: "semester", module: "" };
const moduleBoard = { level: "5", semester: "1", group: "core", kind: "module", module: "cm2005" };

test("ranking publication: validation, preview, atomic publish, retirement, concurrency, rollback, and withdrawal", async (context) => {
  const publisher = await staffSession(context, "m3-publisher", "publisher");
  const student = await studentSession(context, "m3-pub-student");
  const unverified = await staffSession(context, "m3-publisher-aal1", "publisher", { mfa: false });
  const upload = (session, csv, headers) => call(session, "/api/staff/leaderboards/drafts", {
    method: "POST", body: { academicYear: "2026-27", csv }, headers,
  });

  assert.equal((await call(null, "/api/staff/leaderboards/history")).status, 401, "anonymous history is refused");
  assert.equal((await call(student, "/api/staff/leaderboards/history")).status, 403, "students cannot see publication history");
  assert.equal((await upload(student, example)).status, 403, "students cannot upload rankings");
  assert.equal((await upload(unverified, example)).status, 403, "publisher without MFA step-up cannot upload");
  assert.equal((await upload(publisher, example, { "X-CSRF-Token": "x".repeat(43) })).status, 403, "CSRF token is required");
  const crossSite = await api("/api/staff/leaderboards/drafts", {
    method: "POST", origin: "https://evil.example", headers: { Cookie: publisher.cookie, "X-CSRF-Token": publisher.csrfToken },
    body: { academicYear: "2026-27", csv: example },
  });
  assert.equal(crossSite.status, 403, "cross-origin upload is refused");

  const tampered = await upload(publisher, example.replace("avatar_family", "avatar_family,grade").replace(/\n/u, "\n").split("\n")
    .map((line, index) => index === 0 ? line : line && `${line},91`).join("\n"));
  assert.equal(tampered.status, 422, "a sensitive extra column is rejected");
  assert.ok((await json(tampered)).errors.length >= 1);
  const duplicate = await upload(publisher, example.replace(",2,Karim Saad,", ",1,Karim Saad,"));
  assert.equal(duplicate.status, 422, "duplicate ranks are rejected");
  assert.deepEqual((await board(semesterBoard)).rows, [], "nothing is public after rejected uploads");

  const firstDraft = await upload(publisher, example);
  assert.equal(firstDraft.status, 201);
  const first = await json(firstDraft);
  assert.equal(first.diff.added.length, 4, "preview lists every new board");
  assert.deepEqual((await board(semesterBoard)).rows, [], "a draft is not public");

  const publish = (id) => call(publisher, "/api/staff/leaderboards/publish", { method: "POST", body: { publicationId: id } });
  assert.equal((await call(student, "/api/staff/leaderboards/publish", { method: "POST", body: { publicationId: first.draft.id } })).status, 403,
    "students cannot publish");
  assert.equal((await publish(first.draft.id)).status, 200);
  const live = await board(semesterBoard);
  assert.equal(live.rows.length, 10);
  assert.deepEqual(Object.keys(live.rows[0]).sort(), ["avatar", "name", "position", "style"], "rows contain only public fields");
  assert.match(live.publishedAt, /^\d{4}-\d{2}-\d{2}$/u);
  assert.equal((await board(moduleBoard)).rows.length, 5);
  const catalog = await json(await api("/api/public/catalog?level=5&semester=1"));
  assert.deepEqual(catalog.groups.map((group) => group.key), ["core"]);
  assert.deepEqual(catalog.modules.core.map((item) => item.key).sort(), ["cm2005", "cm2010"]);

  const secondDraft = await json(await upload(publisher, semesterOnly));
  assert.equal(secondDraft.diff.removed.length, 3, "preview shows boards that will be retired");
  assert.equal((await publish(secondDraft.draft.id)).status, 200);
  assert.deepEqual((await board(moduleBoard)).rows, [], "an omitted board disappears");
  assert.deepEqual((await json(await api("/api/public/catalog?level=5&semester=1"))).modules, {}, "retired modules leave the catalog");

  const concurrent = await Promise.all([publish(first.draft.id), publish(secondDraft.draft.id), publish(first.draft.id)]);
  assert.ok(concurrent.every((response) => response.status === 200), "concurrent publications serialize");
  const history = await json(await call(publisher, "/api/staff/leaderboards/history"));
  assert.equal(history.publications.filter((item) => item.state === "live").length, 1, "exactly one publication is live");

  assert.equal((await publish(first.draft.id)).status, 200, "rollback to version 1");
  assert.equal((await board(moduleBoard)).rows.length, 5, "rollback restores the complete earlier publication");

  const withdraw = await call(publisher, "/api/staff/leaderboards/withdraw", { method: "POST", body: {} });
  assert.deepEqual(await json(withdraw), { withdrawn: true });
  assert.deepEqual((await board(semesterBoard)).rows, [], "withdrawn rankings are not public");
  assert.deepEqual((await json(await api("/api/public/catalog?level=5&semester=1"))).groups, []);
  assert.equal((await api("/api/public/leaderboards?level=7&semester=1&group=core&kind=semester")).status, 400, "invalid filters are rejected");
});
