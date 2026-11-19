// V1.4: staff-reviewed default board characters through the BFF, and their
// precedence below a linked, opted-in student's own character.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { api, json } from "./bff-fixtures.mjs";
import { call, staffSession, studentSession } from "./m3-helpers.mjs";

const example = readFileSync(new URL("../../data/ranking-upload.example.csv", import.meta.url), "utf8");
const board = async (level) => json(await api(`/api/public/leaderboards?level=${level}`));

test("staff-reviewed default characters: AAL2 only, per publication, allowlisted, below a student's own character", async (context) => {
  const publisher = await staffSession(context, "v14-publisher", "publisher");
  const student = await studentSession(context, "v14-student");
  const upload = async (csv, releaseLabel) => (await json(await call(publisher, "/api/staff/leaderboards/drafts", {
    method: "POST", body: { academicYear: "2026-27", releaseLabel, csv } }))).draft.id;
  const publish = (id) => call(publisher, "/api/staff/leaderboards/publish", { method: "POST", body: { publicationId: id } });
  const approve = (session, publicationId, assignments) => call(session, "/api/staff/leaderboards/artwork", { method: "POST", body: { publicationId, assignments } });

  const v1 = await upload(example, "Week 5");
  assert.equal((await publish(v1)).status, 200);
  assert.ok((await board(4)).rows.every((row) => !("avatar" in row)), "no characters before review");

  assert.equal((await call(null, `/api/staff/leaderboards/artwork?publicationId=${v1}`)).status, 401);
  assert.equal((await approve(student, v1, [{ level: 4, rank: 1, character: "omar" }])).status, 403, "students cannot assign characters");
  for (const bad of [
    [{ level: 4, rank: 1, character: "assets/x.png" }],
    [{ level: 4, rank: 1, character: "omar", gender: "x" }],
    [{ level: 7, rank: 1, character: "omar" }],
    [{ level: 4, rank: 1, name: "Someone", character: "omar" }],
  ]) assert.equal((await approve(publisher, v1, bad)).status, 400, "malformed assignment rejected");

  const review = await json(await call(publisher, `/api/staff/leaderboards/artwork?publicationId=${v1}`));
  assert.equal(review.rows.length, 30);
  assert.ok(review.rows.every((row) => row.character === null && typeof row.publicName === "string"));
  assert.deepEqual(await json(await approve(publisher, v1, [
    { level: 4, rank: 1, character: "youssef" }, { level: 4, rank: 2, character: "mariam" }, { level: 5, rank: 1, character: "amara" },
  ])), { approved: 3 });

  const level4 = await board(4);
  assert.deepEqual(level4.rows[0], { position: 1, name: level4.rows[0].name, avatar: "youssef", personalized: false });
  assert.equal(level4.rows[1].avatar, "mariam");
  assert.ok(!("avatar" in level4.rows[2]), "unreviewed rows stay neutral");
  assert.doesNotMatch(JSON.stringify(level4), /gender|male|female|approved_by|account/iu);

  const v2 = await upload(example.replace(/^4,3,[^\n]+$/mu, "4,3,Fictional Newcomer"), "Week 6");
  assert.equal((await publish(v2)).status, 200);
  assert.ok((await board(4)).rows.every((row) => !("avatar" in row)), "a new week never inherits characters by rank");
  assert.equal((await publish(v1)).status, 200, "rollback");
  assert.equal((await board(4)).rows[0].avatar, "youssef", "rollback restores the reviewed characters");

  // A linked, opted-in student's own character takes precedence over the default.
  const admin = await staffSession(context, "v14-admin", "admin");
  assert.equal((await call(student, "/api/me/avatar", { method: "PUT",
    body: { avatar: { base: "zein", style: "ink", tone: "lilac", badge: "⚡" }, showOnLeaderboard: true } })).status, 200);
  assert.equal((await call(admin, "/api/staff/leaderboards/links/approve", { method: "POST",
    body: { publicationId: v1, csv: `level,rank,username\n4,1,${student.identity.username}` } })).status, 200);
  const personal = (await board(4)).rows[0];
  assert.deepEqual([personal.avatar, personal.style, personal.personalized], ["zein", "ink", true], "student choice wins");
  await call(student, "/api/me/avatar", { method: "PUT", body: { avatar: { base: "zein", style: "ink", tone: "lilac", badge: "⚡" }, showOnLeaderboard: false } });
  assert.deepEqual((await board(4)).rows[0].avatar, "youssef", "opting out returns the reviewed default");

  assert.deepEqual(await json(await call(publisher, "/api/staff/leaderboards/withdraw", { method: "POST", body: {} })), { withdrawn: true });
});
