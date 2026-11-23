// Release A: public character synchronization through the real BFF.
// Save -> opt in -> AAL2 admin approves a verified link -> anonymous board
// shows every chosen field -> a later save appears on the next anonymous
// load without another approval; the student's own status always agrees
// with the anonymous board. Opt-out, suspension, publication replacement,
// withdrawal and rollback fall back correctly. Fictional accounts only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { api, json } from "./bff-fixtures.mjs";
import { call, staffSession, studentSession } from "./m3-helpers.mjs";

const example = readFileSync(new URL("../../data/ranking-upload.example.csv", import.meta.url), "utf8");
// Every board read is a fresh, cookie-less request, like a signed-out browser.
const board = async (level) => json(await api(`/api/public/leaderboards?level=${level}`));
const csvOf = (rows) => ["level,rank,username", ...rows.map((row) => row.join(","))].join("\n");
const features = (value) => execFileSync(process.execPath,
  ["scripts/student-accounts.mjs", "features", "--target", "local", "--set", `avatar_personalization=${value}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("release A: a linked, opted-in student's saved look syncs to the public board", async (context) => {
  const admin = await staffSession(context, "v17-admin", "admin");
  const alpha = await studentSession(context, "v17-alpha"); // Level 4 rank 1 (podium)
  const bravo = await studentSession(context, "v17-bravo"); // Level 5 rank 6 (ranks 4-10)
  const charlie = await studentSession(context, "v17-charlie"); // outside the top 10
  const state = async (session) => (await json(await call(session, "/api/me/avatar"))).publication;
  const save = (session, avatar, showOnLeaderboard) => call(session, "/api/me/avatar", {
    method: "PUT", body: showOnLeaderboard === undefined ? { avatar } : { avatar, showOnLeaderboard } });
  const approveLinks = (publicationId, rows) => call(admin, "/api/staff/leaderboards/links/approve", {
    method: "POST", body: { publicationId, csv: csvOf(rows) } });
  const listLinks = async (publicationId) => (await json(await call(admin, `/api/staff/leaderboards/links?publicationId=${publicationId}`))).links;
  const publish = (publicationId) => call(admin, "/api/staff/leaderboards/publish", { method: "POST", body: { publicationId } });
  const upload = async (csv, releaseLabel) => (await json(await call(admin, "/api/staff/leaderboards/drafts", {
    method: "POST", body: { academicYear: "2026-27", releaseLabel, csv } }))).draft.id;
  features("on");

  const week5 = await upload(example, "Week 5");
  assert.equal((await publish(week5)).status, 200);

  // ---- nothing saved yet; a student outside the top 10 can still save
  assert.equal(await state(alpha), "not_saved");
  assert.equal((await save(charlie, { base: "amara", style: "ink", tone: "mint", badge: "✦" }, true)).status, 200);
  assert.equal(await state(charlie), "awaiting_link", "outside the top 10: saved and opted in, never claimed public");

  // ---- save + opt in: awaiting a verified link, nothing public yet
  const alphaLook = { base: "tariq", style: "ink", tone: "coral", badge: "⚡" };
  const saved = await json(await save(alpha, alphaLook, true));
  assert.equal(saved.publication, "awaiting_link", "the save response carries the server-computed state");
  assert.ok((await board(4)).rows.every((row) => row.personalized === false));
  const bravoLook = { base: "mariam", style: "cartoon3d", tone: "gold", badge: "♥" };
  assert.equal((await save(bravo, bravoLook, true)).status, 200);

  // ---- the AAL2 admin approves verified links (by username only)
  assert.deepEqual(await listLinks(week5), []);
  assert.equal((await approveLinks(week5, [[4, 1, alpha.identity.username], [5, 6, bravo.identity.username]])).status, 200);
  const podium = (await board(4)).rows[0];
  assert.deepEqual({ ...podium, name: undefined },
    { position: 1, name: undefined, avatar: "tariq", style: "ink", tone: "coral", badge: "⚡", personalized: true },
    "podium row carries the saved character, style, backdrop and sticker");
  const rank6 = (await board(5)).rows[5];
  assert.deepEqual([rank6.position, rank6.avatar, rank6.style, rank6.tone, rank6.badge, rank6.personalized],
    [6, "mariam", "cartoon3d", "gold", "♥", true], "ranks 4-10 carry every saved field");
  assert.equal(await state(alpha), "public");
  assert.equal(await state(bravo), "public");
  assert.equal(await state(charlie), "awaiting_link");
  assert.doesNotMatch(JSON.stringify(await board(4)), /username|account|email|v17-/iu, "the public board never names accounts");

  // ---- a later save appears on the next anonymous load, with no new approval
  const linksBefore = await listLinks(week5);
  const newLook = { base: "zein", style: "cartoon3d", tone: "lilac", badge: "★" };
  assert.equal((await save(alpha, newLook)).status, 200, "a look-only save keeps the opt-in");
  const updated = (await board(4)).rows[0];
  assert.deepEqual([updated.avatar, updated.style, updated.tone, updated.badge], ["zein", "cartoon3d", "lilac", "★"]);
  assert.deepEqual(await listLinks(week5), linksBefore, "no link was re-approved or changed");
  assert.equal(await state(alpha), "public");

  // ---- approval replaces the whole set: an upload without bravo drops bravo
  assert.equal((await approveLinks(week5, [[4, 1, alpha.identity.username]])).status, 200);
  assert.equal((await board(5)).rows[5].personalized, false);
  assert.equal(await state(bravo), "awaiting_link");
  assert.equal((await approveLinks(week5, [[4, 1, alpha.identity.username], [5, 6, bravo.identity.username]])).status, 200);
  assert.equal(await state(bravo), "public", "re-adding the link restores it");

  // ---- opt-out falls back at once; opting back in needs no approval
  assert.equal((await save(bravo, bravoLook, false)).status, 200);
  assert.equal((await board(5)).rows[5].personalized, false);
  assert.equal(await state(bravo), "display_off");
  assert.equal((await save(bravo, bravoLook, true)).status, 200);
  assert.equal((await board(5)).rows[5].personalized, true);

  // ---- personalization switched off for everyone: saved privately, board unchanged otherwise
  features("off");
  assert.equal((await board(4)).rows[0].personalized, false);
  assert.equal(await state(alpha), "saved_private");
  features("on");

  // ---- publication replacement: links are per publication
  const week6 = await upload(example.replace(/^4,3,[^\n]+$/mu, "4,3,Fictional Newcomer"), "Week 6");
  assert.equal((await publish(week6)).status, 200);
  assert.ok((await board(4)).rows.every((row) => row.personalized === false), "links never carry over to a new week");
  assert.equal(await state(alpha), "awaiting_link");

  // ---- rollback restores that version's links with the latest saved look
  assert.equal((await publish(week5)).status, 200);
  assert.deepEqual([(await board(4)).rows[0].avatar, (await board(4)).rows[0].tone], ["zein", "lilac"]);
  assert.equal(await state(alpha), "public");

  // ---- suspension removes the character from the public board immediately
  assert.equal((await call(admin, "/api/staff/accounts/suspend", { method: "POST", body: { username: bravo.identity.username } })).status, 200);
  assert.equal((await board(5)).rows[5].personalized, false, "a suspended student's character leaves the board");
  assert.equal((await board(4)).rows[0].personalized, true, "other students are unaffected");

  // ---- a header-only file clears every link of the publication (runbook §6)
  assert.equal((await approveLinks(week5, [])).status, 200);
  assert.deepEqual(await listLinks(week5), []);
  assert.equal((await board(4)).rows[0].personalized, false);
  assert.equal(await state(alpha), "awaiting_link");
  assert.equal((await approveLinks(week5, [[4, 1, alpha.identity.username]])).status, 200);
  assert.equal(await state(alpha), "public");

  // ---- withdrawal: nothing public, and nobody is told otherwise
  assert.deepEqual(await json(await call(admin, "/api/staff/leaderboards/withdraw", { method: "POST", body: {} })), { withdrawn: true });
  assert.equal(await state(alpha), "awaiting_link");
});
