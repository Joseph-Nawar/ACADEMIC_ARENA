import assert from "node:assert/strict";
import test from "node:test";
import { api, json } from "./bff-fixtures.mjs";
import { call, staffSession, studentSession } from "./m3-helpers.mjs";

// Release B2 (issue #25): this author never gave the separate Campus Wins
// consent, so the post carries no character fields at all (neutral figure),
// instead of the look snapshotted at approval. Consented looks are covered in
// v18-character-v2-rewards.
const PUBLIC_POST_KEYS = ["author", "counts", "created", "id", "type"];

async function feed() {
  const response = await api("/api/public/campus-wins?category=all");
  assert.equal(response.status, 200);
  return (await json(response)).posts;
}

test("Campus Wins: canonical names, limits, private pending queue, moderation, reactions, and hiding", async (context) => {
  const admin = await staffSession(context, "m3-wins-admin", "admin");
  const moderator = await staffSession(context, "m3-moderator", "moderator");
  const moderatorAal1 = await staffSession(context, "m3-moderator-aal1", "moderator", { mfa: false });
  const author = await studentSession(context, "m3-author");
  const fans = await Promise.all([1, 2, 3].map((index) => studentSession(context, `m3-fan${index}`)));

  const submit = (session, type = "top3") => call(session, "/api/me/achievements", { method: "POST", body: { type } });
  assert.equal((await submit(author)).status, 409, "submission needs a staff-approved public name");
  const setName = (session, username, publicName) =>
    call(session, "/api/staff/accounts/public-name", { method: "POST", body: { username, publicName } });
  assert.equal((await setName(author, author.identity.username, "Me Myself")).status, 403, "students cannot set public names");
  assert.equal((await setName(admin, author.identity.username, "<script>alert(1)</script>")).status, 400, "markup is rejected");
  assert.equal((await setName(admin, author.identity.username, "Laila Farouk")).status, 200);

  assert.equal((await call(author, "/api/me/achievements", { method: "POST", body: { type: "top3", caption: "hi" } })).status, 400,
    "free text is not accepted");
  assert.equal((await submit(author, "custom")).status, 400, "only predefined templates");
  const created = await submit(author);
  assert.equal(created.status, 201);
  const { id } = await json(created);
  assert.equal((await submit(author, "helped")).status, 409, "only one pending submission");
  assert.deepEqual((await json(await call(author, "/api/me/achievements"))).submissions.map((item) => item.status), ["pending"]);
  assert.deepEqual((await json(await call(fans[0], "/api/me/achievements"))).submissions, [], "submissions are private to their owner");
  assert.equal((await feed()).some((post) => post.id === id), false, "pending posts are not public");

  assert.equal((await call(author, "/api/staff/campus-wins/pending")).status, 403, "students cannot see the queue");
  assert.equal((await call(moderatorAal1, "/api/staff/campus-wins/pending")).status, 403, "moderators need MFA step-up");
  const queue = await json(await call(moderator, "/api/staff/campus-wins/pending"));
  assert.ok(queue.posts.some((post) => post.id === id && post.author === "Laila Farouk"));
  const moderate = (session, decision) => call(session, `/api/staff/campus-wins/${id}/moderation`, { method: "POST", body: { decision } });
  assert.equal((await moderate(author, "approved")).status, 403, "students cannot moderate");
  assert.equal((await moderate(moderator, "hidden")).status, 409, "pending posts cannot be hidden");
  assert.equal((await moderate(moderator, "approved")).status, 200);

  const published = (await feed()).find((post) => post.id === id);
  assert.ok(published, "approved post is public");
  assert.deepEqual(Object.keys(published).sort(), PUBLIC_POST_KEYS, "public posts contain only allowlisted fields");
  assert.equal(published.author, "Laila Farouk");
  assert.equal(JSON.stringify(published).includes(author.identity.accountId), false);
  assert.equal(JSON.stringify(published).includes(author.identity.email), false);
  assert.equal((await submit(author, "helped")).status, 429, "one new submission per seven days");

  const react = (session, reaction) => call(session, `/api/public/campus-wins/${id}/reaction`, { method: "PUT", body: { reaction } });
  assert.equal((await call(null, `/api/public/campus-wins/${id}/reaction`, { method: "PUT", body: { reaction: "heart" } })).status, 401,
    "anonymous visitors cannot react");
  assert.equal((await react(moderator, "heart")).status, 403, "staff cannot react");
  assert.equal((await react(fans[0], "angry")).status, 400, "only heart, clap, and fire");
  const responses = await Promise.all(fans.map((fan) => react(fan, "fire")));
  assert.ok(responses.every((response) => response.status === 200));
  assert.deepEqual((await feed()).find((post) => post.id === id).counts, [0, 0, 3], "concurrent reactions are all counted once");

  const toggles = await Promise.all(Array.from({ length: 7 }, () => react(fans[0], "heart")));
  assert.ok(toggles.every((response) => response.status === 200));
  const mine = (await json(await call(fans[0], "/api/me/campus-win-reactions"))).reactions[id] ?? null;
  const counts = (await feed()).find((post) => post.id === id).counts;
  assert.equal(counts[0] + counts[2], 3, "a student holds exactly one reaction per post");
  assert.equal(counts[0], mine === "heart" ? 1 : 0, "aggregate counts match the stored reaction");
  assert.ok(counts.every((count) => count >= 0));

  assert.equal((await moderate(moderator, "hidden")).status, 200);
  assert.equal((await feed()).some((post) => post.id === id), false, "hidden posts leave the feed");
  assert.equal((await react(fans[1], "clap")).status, 404, "hidden posts cannot receive reactions");
  assert.equal((await moderate(moderator, "removed")).status, 200);
  const removedHistory = await json(await call(moderator, "/api/staff/campus-wins/history?status=removed"));
  assert.ok(removedHistory.posts.some((post) => post.id === id), "moderation history lists removed posts");
  assert.equal((await json(await call(author, "/api/me/achievements"))).submissions[0].status, "not_shown");
});
