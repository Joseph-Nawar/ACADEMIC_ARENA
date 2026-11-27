// Release B2 through the real BFF: a student keeps their classic look, creates
// a V2 character, earns verified rank rewards (idempotently), equips an earned
// item, and every signed-out request sees the complete updated look. Locked
// items, tampered bodies and stale saves are refused. Rewards are corrected
// with an audited reconcile. Campus Wins needs its own consent (issue #25).
// Fictional accounts and fictional ranking files only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { api, json } from "./bff-fixtures.mjs";
import { call, staffSession, studentSession } from "./m3-helpers.mjs";

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../../assets/avatar-v2/catalog.js", import.meta.url), "utf8"), { globalThis: sandbox, TextEncoder });
const catalog = sandbox.AcademicArenaAvatarCatalog;
const look = (changes = {}) => ({ ...catalog.DEFAULT_CONFIG, details: [], ...changes });

const example = readFileSync(new URL("../../data/ranking-upload.example.csv", import.meta.url), "utf8");
const board = async (level) => json(await api(`/api/public/leaderboards?level=${level}`));
const feed = async () => (await json(await api("/api/public/campus-wins?category=all"))).posts;
const csvOf = (rows) => ["level,rank,username", ...rows.map((row) => row.join(","))].join("\n");
const feature = (name, value) => execFileSync(process.execPath,
  ["scripts/student-accounts.mjs", "features", "--target", "local", "--set", `${name}=${value}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("release B2: V2 characters, server-owned rewards and public sync", async (context) => {
  const admin = await staffSession(context, "v18-admin", "admin");
  const alpha = await studentSession(context, "v18-alpha"); // Level 4 #1, later corrected to #2
  const bravo = await studentSession(context, "v18-bravo"); // Level 4 #2, later corrected to #1
  const charlie = await studentSession(context, "v18-charlie"); // Level 5 #7, keeps their character private
  const me = async (session) => json(await call(session, "/api/me/character"));
  const saveV2 = (session, body) => call(session, "/api/me/character", { method: "PUT", body });
  const upload = async (csv, releaseLabel) => (await json(await call(admin, "/api/staff/leaderboards/drafts", {
    method: "POST", body: { academicYear: "2026-27", releaseLabel, csv } }))).draft.id;
  const publish = (publicationId) => call(admin, "/api/staff/leaderboards/publish", { method: "POST", body: { publicationId } });
  const approveLinks = (publicationId, rows) => call(admin, "/api/staff/leaderboards/links/approve", {
    method: "POST", body: { publicationId, csv: csvOf(rows) } });
  const preview = async (publicationId, periodKey) => (await json(await call(admin, "/api/staff/rewards/preview", {
    method: "POST", body: { publicationId, periodKey } }))).preview;
  const processRewards = (publicationId, periodKey, mode = "grant") => call(admin, "/api/staff/rewards/process", {
    method: "POST", body: { publicationId, periodKey, periodLabel: "Week 5", mode } });
  feature("avatar_personalization", "on");
  feature("character_studio_v2", "off");
  feature("cosmetic_rewards", "off");

  const week5 = await upload(example, "Week 5");
  assert.equal((await publish(week5)).status, 200);
  const links = [[4, 1, alpha.identity.username], [4, 2, bravo.identity.username], [5, 7, charlie.identity.username]];
  assert.equal((await approveLinks(week5, links)).status, 200);

  // ---- an existing classic look is preserved, never converted
  const classic = { base: "tariq", style: "ink", tone: "coral", badge: "⚡" };
  assert.equal((await call(alpha, "/api/me/avatar", { method: "PUT", body: { avatar: classic, showOnLeaderboard: true } })).status, 200);
  let state = await me(alpha);
  assert.deepEqual([state.activeLook, state.v2, state.classic, state.showOnLeaderboard, state.showOnCampusWins],
    ["classic", null, classic, true, false]);
  assert.deepEqual(state.owned, ["essentials"]);

  // ---- V2 is refused until the switch is on
  const first = look({ hair: "locs", hairColor: "h05", skin: "s08", top: "tunic", topColor: "c10" });
  assert.equal((await saveV2(alpha, { expectedRevision: state.revision, activeLook: "v2", v2: first, showOnLeaderboard: true, showOnCampusWins: false })).status, 409);
  feature("character_studio_v2", "on");
  const saved = await saveV2(alpha, { expectedRevision: state.revision, activeLook: "v2", v2: first, showOnLeaderboard: true, showOnCampusWins: false });
  assert.equal(saved.status, 200);
  state = await json(saved);
  assert.equal(state.activeLook, "v2");
  assert.deepEqual(state.classic, classic, "the classic look is kept alongside");
  assert.equal(state.publication, "public");
  assert.deepEqual((await board(4)).rows[0], { position: 1, name: (await board(4)).rows[0].name, v2: first, personalized: true },
    "a signed-out request sees the complete V2 look");
  assert.doesNotMatch(JSON.stringify(await board(4)), /username|account|email|v18-|revision|owned/iu);

  // ---- tampering, locked items and stale saves are refused
  const base = { expectedRevision: state.revision, activeLook: "v2", showOnLeaderboard: true, showOnCampusWins: false };
  for (const [v2, why] of [
    [{ ...first, extra: "x" }, "unknown field"],
    [{ ...first, skin: "#ff0000" }, "raw colour"],
    [{ ...first, top: "<svg onload=alert(1)>" }, "markup"],
    [{ ...first, details: ["freckles", "freckles"] }, "duplicate detail"],
    [{ ...first, hair: "afro", headwear: "beanie" }, "fitted hat over big hair"],
  ]) assert.equal((await saveV2(alpha, { ...base, v2 })).status, 400, why);
  assert.equal((await saveV2(alpha, { ...base, v2: first, activeLook: "v3" })).status, 400, "unknown look");
  assert.equal((await saveV2(alpha, { ...base, v2: first, owned: ["champion"] })).status, 400, "clients cannot claim ownership");
  const locked = await saveV2(alpha, { ...base, v2: { ...first, back: "cape" } });
  assert.deepEqual([locked.status, (await json(locked)).error], [403, "item_not_owned"], "an unearned cosmetic cannot be equipped");
  const stale = await saveV2(alpha, { ...base, expectedRevision: base.expectedRevision - 1, v2: first });
  assert.deepEqual([stale.status, (await json(stale)).error], [409, "character_changed"], "a stale save never overwrites");
  assert.equal((await call(null, "/api/me/character")).status, 401);
  assert.equal((await call(admin, "/api/me/character")).status, 403, "staff have no character");

  // ---- reward preview: aggregates only; processing needs the owner switch
  assert.equal((await call(alpha, "/api/staff/rewards/preview", { method: "POST", body: { publicationId: week5, periodKey: "2026-27:week-05" } })).status, 403);
  const before = await preview(week5, "2026-27:week-05");
  assert.deepEqual([before.collections.elite.newGrants, before.collections.podium.newGrants, before.collections.champion.newGrants], [3, 2, 1]);
  assert.equal(before.exclusions.unlinked, 27);
  assert.doesNotMatch(JSON.stringify(before), /v18-|@|username/iu);
  assert.deepEqual([(await processRewards(week5, "2026-27:week-05")).status], [409], "nothing is granted with rewards switched off");
  feature("cosmetic_rewards", "on");
  assert.equal((await json(await processRewards(week5, "2026-27:week-05"))).result.granted, 6);
  assert.equal((await json(await processRewards(week5, "2026-27:week-05"))).result.granted, 0, "a retry grants nothing");
  assert.equal((await processRewards(week5, "2026-27:week-05-retry")).status, 409, "re-keying the same publication is refused");
  assert.deepEqual((await me(charlie)).owned, ["elite", "essentials"], "a private-character student still earns");

  // ---- equip an earned item; another visitor sees it on the next load
  state = await me(alpha);
  assert.deepEqual(state.owned, ["champion", "elite", "essentials", "podium"]);
  const champion = { ...first, back: "cape", headwear: "laurel", shoes: "gold", backdrop: "hall", sticker: "trophy" };
  state = await json(await saveV2(alpha, { ...base, expectedRevision: state.revision, v2: champion }));
  assert.equal(state.saved, true);
  assert.deepEqual((await board(4)).rows[0].v2, champion, "the complete earned look is public");

  // ---- classic and V2 switch back and forth without losing either
  assert.equal((await call(alpha, "/api/me/avatar", { method: "PUT", body: { avatar: classic } })).status, 200);
  assert.equal((await board(4)).rows[0].avatar, "tariq", "saving in the classic studio shows the classic look");
  state = await me(alpha);
  assert.deepEqual(state.v2, champion, "the V2 look is still stored");
  state = await json(await saveV2(alpha, { ...base, expectedRevision: state.revision, v2: null }));
  assert.deepEqual((await board(4)).rows[0].v2, champion, "switching back needs no re-save of the look");

  // ---- a correction: reconcile revokes, audited, and falls back equipped items
  const corrected = await upload(example, "Week 5");
  assert.equal((await publish(corrected)).status, 200);
  assert.equal((await approveLinks(corrected, [[4, 1, bravo.identity.username], [4, 2, alpha.identity.username], [5, 7, charlie.identity.username]])).status, 200);
  const fix = await preview(corrected, "2026-27:week-05");
  assert.deepEqual([fix.collections.champion.newGrants, fix.collections.champion.wouldRevoke], [1, 1]);
  const reconciled = (await json(await processRewards(corrected, "2026-27:week-05", "reconcile"))).result;
  assert.deepEqual([reconciled.granted, reconciled.revoked, reconciled.equippedFallbacks], [1, 1, 1]);
  const after = (await board(4)).rows[1];
  assert.deepEqual([after.v2.back, after.v2.headwear, after.v2.shoes, after.v2.backdrop, after.v2.sticker, after.v2.hair],
    ["none", "none", "sneakers", "mint", "spark", "locs"], "only the revoked Champion items fell back; the rest of the look is kept");
  assert.equal((await saveV2(alpha, { ...base, expectedRevision: state.revision, v2: champion })).status, 409,
    "a tab from before the fallback cannot restore it");
  state = await me(alpha);
  assert.equal((await saveV2(alpha, { ...base, expectedRevision: state.revision, v2: champion })).status, 403, "nor can a fresh one");
  assert.ok(state.owned.includes("podium"), "Podium is still owned (still in the Top 3)");
  // Rolling back to the first version grants nothing new.
  assert.equal((await publish(week5)).status, 200);
  assert.equal((await json(await processRewards(week5, "2026-27:week-05"))).result.granted, 0);
  assert.equal((await json(await processRewards(corrected, "2026-27:week-05"))).result.granted, 0);
  const history = (await json(await call(admin, "/api/staff/rewards"))).periods.find((period) => period.key === "2026-27:week-05");
  assert.deepEqual([history.active.champion, history.revoked], [1, 1]);

  // ---- Campus Wins: a separate consent and always the latest look (issue #25)
  assert.equal((await call(admin, "/api/staff/accounts/public-name", { method: "POST", body: { username: alpha.identity.username, publicName: "Fictional Alpha" } })).status, 200);
  const { id } = await json(await call(alpha, "/api/me/achievements", { method: "POST", body: { type: "workshop" } }));
  assert.equal((await call(admin, `/api/staff/campus-wins/${id}/moderation`, { method: "POST", body: { decision: "approved" } })).status, 200);
  let post = (await feed()).find((item) => item.id === id);
  assert.deepEqual(Object.keys(post).sort(), ["author", "counts", "created", "id", "type"], "leaderboard consent alone: neutral figure");
  state = await me(alpha);
  state = await json(await saveV2(alpha, { ...base, expectedRevision: state.revision, v2: { ...first, hair: "braids" }, showOnCampusWins: true }));
  post = (await feed()).find((item) => item.id === id);
  assert.equal(post.v2.hair, "braids", "with consent the win shows the latest saved look");
  state = await json(await saveV2(alpha, { ...base, expectedRevision: state.revision, v2: { ...first, hair: "bun" }, showOnCampusWins: true }));
  assert.equal((await feed()).find((item) => item.id === id).v2.hair, "bun", "a later change shows on the next read");
  state = await json(await saveV2(alpha, { ...base, expectedRevision: state.revision, v2: null, showOnCampusWins: false }));
  assert.equal((await feed()).find((item) => item.id === id).v2, undefined, "withdrawing consent restores the neutral figure");
  assert.equal((await board(4)).rows[0].v2.hair, "bun", "while the leaderboard consent is unaffected");
  assert.equal((await call(admin, `/api/staff/campus-wins/${id}/moderation`, { method: "POST", body: { decision: "hidden" } })).status, 200);
  assert.equal((await feed()).some((item) => item.id === id), false, "hidden wins disappear");
  assert.equal((await call(admin, `/api/staff/campus-wins/${id}/moderation`, { method: "POST", body: { decision: "approved" } })).status, 200);

  // ---- suspension removes the look everywhere; the reviewed default remains
  assert.equal((await call(admin, "/api/staff/accounts/suspend", { method: "POST", body: { username: alpha.identity.username } })).status, 200);
  assert.equal((await board(4)).rows[0].personalized, false);
  assert.equal((await feed()).some((item) => item.id === id), false, "a suspended author's wins disappear");

  feature("character_studio_v2", "off");
  feature("cosmetic_rewards", "off");
});
