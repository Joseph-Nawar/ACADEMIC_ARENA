// Character V2: catalog targets, validation contract, and renderer safety.
import assert from "node:assert/strict";
import test from "node:test";
import "../../assets/avatar-v2/catalog.js";
import "../../assets/avatar-v2/render.js";

const C = globalThis.AcademicArenaAvatarCatalog;
const R = globalThis.AcademicArenaAvatarRenderer;
const base = () => ({ ...C.DEFAULT_CONFIG, details: [] });
const all = new Set(Object.keys(C.items));

// Tiny well-formedness check: balanced tags, no stray text outside elements.
function wellFormed(svg) {
  const stack = [];
  for (const match of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) continue;
    if (closing) { if (stack.pop() !== name) return false; } else stack.push(name);
  }
  return stack.length === 0;
}
function random(seed) {
  let value = seed;
  return () => { value = (Math.imul(value, 1103515245) + 12345) >>> 0; return value / 2 ** 32; };
}
function randomConfig(rand, ownedItems = all) {
  const config = { v: C.SCHEMA_VERSION };
  for (const [field, f] of Object.entries(C.fields)) {
    if (f.kind === "set") { config[field] = f.values.filter(() => rand() < 0.2).slice(0, f.max); continue; }
    const values = f.kind === "item" ? f.values.filter((value) => ownedItems.has(`${f.slot}.${value}`)) : f.values;
    config[field] = values[Math.floor(rand() * values.length)];
  }
  return config;
}

test("launch catalogue meets the inclusive content targets", () => {
  const count = (field) => C.fields[field].values.length;
  assert.equal(count("skin"), 12);
  assert.equal(count("face"), 6);
  assert.equal(count("build"), 4);
  assert.ok(count("hair") >= 20, "20+ hairstyles");
  assert.equal(count("hairColor"), 16);
  assert.equal(count("eyes"), 8);
  assert.equal(count("eyeColor"), 10);
  assert.equal(count("brows"), 8);
  assert.equal(count("nose"), 6);
  assert.equal(count("mouth"), 10);
  assert.equal(count("facialHair"), 10);
  const coverings = Object.entries(C.items).filter(([, item]) => item.slot === "headwear" && item.hidesHair);
  assert.ok(coverings.length >= 4, "multiple headscarf/wrap styles");
  for (const texture of ["bald", "buzz", "fade", "afro", "locs", "braids", "cornrows", "curlylong", "wavylong", "straightlong"]) assert.ok(C.fields.hair.values.includes(texture), texture);
  for (const reward of ["elite", "podium", "champion", "scholar", "seasonal"]) assert.ok(C.itemsInCollection(reward).length >= 3, `${reward} has several cosmetics`);
});

test("identity, access and everyday items are always free", () => {
  for (const [key, item] of Object.entries(C.items)) {
    if (["hearing", "mobility", "glasses", "earrings", "bottom"].includes(item.slot)) assert.equal(item.collection, "essentials", key);
    if (item.slot === "headwear" && (item.hidesHair || ["none", "kufi", "beanie", "cap", "bucket"].includes(key.split(".")[1]))) assert.equal(item.collection, "essentials", key);
  }
  for (const slot of ["top", "shoes", "neck", "back", "backdrop", "sticker"]) {
    assert.ok(Object.values(C.items).filter((item) => item.slot === slot && item.collection === "essentials").length >= 3 || slot === "neck" || slot === "back", slot);
  }
  // Non-item fields (skin, hair, features, makeup, details) have no ownership at all.
  for (const [field, f] of Object.entries(C.fields)) if (f.kind !== "item") assert.ok(!("slot" in f), field);
});

test("the default look validates and every field is required", () => {
  assert.equal(C.validateConfig(base()).ok, true);
  for (const field of Object.keys(C.fields)) {
    const config = base();
    delete config[field];
    const result = C.validateConfig(config);
    assert.equal(result.ok, false, field);
    assert.ok(result.errors.some((error) => error.field === field && error.code === "missing"));
  }
});

test("validation rejects unknown fields, wrong types, bad colours and oversize input", () => {
  const cases = [
    [{ ...base(), extra: 1 }, "unknown_field"],
    [{ ...base(), __proto__: { hacked: true }, constructor: "x" }, "unknown_field"],
    [{ ...base(), v: 1 }, "bad_version"],
    [{ ...base(), skin: "#ffffff" }, "invalid"],
    [{ ...base(), topColor: "red" }, "invalid"],
    [{ ...base(), hair: "url(javascript:alert(1))" }, "invalid"],
    [{ ...base(), hair: ["afro"] }, "invalid"],
    [{ ...base(), mouth: { toString: () => "smile" } }, "invalid"],
    [{ ...base(), details: ["freckles", "freckles"] }, "invalid"],
    [{ ...base(), details: ["freckles", "dimples", "rosy", "lashes"] }, "invalid"],
    [{ ...base(), details: "freckles" }, "invalid"],
    [{ ...base(), backdrop: "<svg onload=alert(1)>" }, "invalid"],
    [{ ...base(), sticker: "x".repeat(2000) }, "too_large"],
  ];
  for (const [input, code] of cases) {
    const result = C.validateConfig(input);
    assert.equal(result.ok, false, JSON.stringify(input).slice(0, 80));
    assert.ok(result.errors.some((error) => error.code === code), `${code}: ${JSON.stringify(result.errors)}`);
  }
  for (const input of [null, undefined, 7, "config", [], [base()]]) assert.equal(C.validateConfig(input).ok, false);
});

test("details are stored in canonical order", () => {
  const result = C.validateConfig({ ...base(), details: ["lashes", "freckles"] });
  assert.deepEqual(result.config.details, ["freckles", "lashes"]);
});

test("locked items can't be saved, owned ones can", () => {
  const locked = { ...base(), top: "varsity", headwear: "laurel" };
  const denied = C.validateConfig(locked);
  assert.equal(denied.ok, false);
  assert.deepEqual(denied.errors.filter((e) => e.code === "not_owned").map((e) => e.item).sort(), ["headwear.laurel", "top.varsity"]);
  assert.equal(C.validateConfig(locked, { ownedItems: new Set(["top.varsity"]) }).ok, false);
  assert.equal(C.validateConfig(locked, { ownedItems: new Set(["top.varsity", "headwear.laurel"]) }).ok, true);
  // A grant from another collection never unlocks this one.
  assert.equal(C.validateConfig({ ...base(), back: "cape" }, { ownedItems: new Set(C.itemsInCollection("elite")) }).ok, false);
});

test("fitted hats can't sit over big hair; crowns and coverings can", () => {
  for (const hair of C.fields.hair.values) {
    for (const headwear of C.fields.headwear.values) {
      const result = C.validateConfig({ ...base(), hair, headwear }, { ownedItems: all });
      const fitted = C.items[`headwear.${headwear}`].fit === "fitted";
      assert.equal(result.ok, !(fitted && C.options.hairstyles[hair].volume === "big"), `${hair} + ${headwear}`);
    }
  }
});

test("rank rewards: Top 10 Elite, Top 3 adds Podium, first adds Champion", () => {
  assert.deepEqual(C.collectionsForPosition(1).sort(), ["champion", "elite", "podium"]);
  assert.deepEqual(C.collectionsForPosition(2).sort(), ["elite", "podium"]);
  assert.deepEqual(C.collectionsForPosition(3).sort(), ["elite", "podium"]);
  assert.deepEqual(C.collectionsForPosition(4), ["elite"]);
  assert.deepEqual(C.collectionsForPosition(10), ["elite"]);
  for (const position of [11, 0, -1, 1.5, "1", null, NaN]) assert.deepEqual(C.collectionsForPosition(position), [], String(position));
  for (const name of ["elite", "podium", "champion"]) assert.ok(!C.itemsInCollection(name).some((key) => key.endsWith(".none")));
});

test("the current-leader crown is not a wardrobe item", () => {
  assert.ok(!Object.keys(C.items).some((key) => /crown/i.test(key) || /crown/i.test(C.items[key].label)));
});

test("every option of every field renders as well-formed, CSP-safe SVG", () => {
  for (const [field, f] of Object.entries(C.fields)) {
    for (const value of f.values) {
      const config = { ...base(), [field]: f.kind === "set" ? [value] : value };
      if (field === "headwear" && C.items[`headwear.${value}`].fit === "fitted") config.hair = "crop";
      for (const context of R.contexts) {
        const svg = R.render(config, { context });
        assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"), `${field}=${value}`);
        assert.ok(wellFormed(svg), `well-formed ${field}=${value} ${context}`);
        assert.doesNotMatch(svg, /undefined|NaN|null|\[object/, `${field}=${value} ${context}`);
        assert.doesNotMatch(svg, /style=|<style|<script|<foreignObject|href=|on[a-z]+=/i, `${field}=${value}`);
      }
    }
  }
});

test("renderer has a drawing for every catalogue key it claims to cover", () => {
  for (const [field, keys] of Object.entries(R.coverage)) assert.deepEqual([...keys].sort(), [...C.fields[field].values].sort(), field);
});

test("random owned combinations render deterministically with unique ids", () => {
  const rand = random(42);
  for (let i = 0; i < 250; i += 1) {
    const config = randomConfig(rand);
    if (C.compatibilityErrors(config).length) config.headwear = "none";
    assert.equal(C.validateConfig(config, { ownedItems: all }).ok, true);
    const a = R.render(config);
    const b = R.render(config);
    assert.equal(a.replace(/aa\d+-/g, "aa-"), b.replace(/aa\d+-/g, "aa-"), "deterministic");
    const ids = [...a.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, "ids unique within one render");
    const other = new Set([...b.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    assert.ok(ids.every((id) => !other.has(id)), "ids unique across renders");
  }
});

test("hostile or legacy input is drawn as the safe default, never echoed", () => {
  const hostile = { hair: "<script>alert(1)</script>", skin: "\"><img src=x onerror=alert(1)>", topColor: "#000;background:url(x)", base: "amara", style: "ink", details: ["<b>"] };
  const svg = R.render(hostile, { title: "Fictional <b>name</b> & \"quotes\"" });
  assert.doesNotMatch(svg, /<script|onerror|<img|<b>|url\(x\)/);
  assert.match(svg, /<title>Fictional &lt;b&gt;name&lt;\/b&gt; &amp; &quot;quotes&quot;<\/title>/);
  assert.equal(R.render(null).length > 1000, true);
  // A classic (V1) look is never converted into guessed V2 features.
  assert.deepEqual(C.normalizeForRender({ base: "amara", style: "ink", tone: "mint", badge: "✦" }), { ...C.DEFAULT_CONFIG, details: [] });
});

test("an incompatible stored look renders without the hat instead of failing", () => {
  const normalized = C.normalizeForRender({ ...base(), hair: "afro", headwear: "beanie" });
  assert.equal(normalized.headwear, "none");
  assert.equal(normalized.hair, "afro");
});

test("public board rows: a valid V2 look is drawn, a tampered one falls back to the reviewed default", async () => {
  await import("../../assets/data-access.js");
  const { createArenaDataAccess } = globalThis.AcademicArenaDataAccess;
  const good = { ...base(), hair: "afro", top: "varsity", neck: "medal" };
  const rows = [
    { position: 1, name: "Fictional A", personalized: true, v2: good, private_note: "x" },
    { position: 2, name: "Fictional B", personalized: true, v2: { ...good, script: "<script>" }, avatar: "amara" },
    { position: 3, name: "Fictional C", personalized: true, v2: { ...good, skin: "#000" } },
    { position: 4, name: "Fictional D", personalized: true, v2: { ...good, hair: "afro", headwear: "beanie" }, avatar: "omar" },
  ];
  const api = createArenaDataAccess({ mode: "production", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ rows }) }) });
  const result = await api.public.getLeaderboard({ level: "4" });
  assert.equal(result.state, "ok");
  assert.deepEqual(result.rows[0], { position: 1, name: "Fictional A", v2: C.validateConfig(good, { ownedItems: all }).config, personalized: true });
  assert.deepEqual(result.rows[1], { position: 2, name: "Fictional B", avatar: "amara", personalized: false });
  assert.deepEqual(result.rows[2], { position: 3, name: "Fictional C", personalized: false });
  assert.deepEqual(result.rows[3], { position: 4, name: "Fictional D", avatar: "omar", personalized: false });
});

test("provenance: original, code-drawn, no third-party or runtime assets", () => {
  assert.equal(C.PROVENANCE.thirdPartyAssets, false);
  assert.equal(C.PROVENANCE.generatedByAI, false);
  assert.equal(C.PROVENANCE.runtimeNetwork, false);
  const svg = R.render({ ...base(), backdrop: "hall", sticker: "trophy" });
  // The namespace declaration is an identifier, not a fetch; nothing else may reference a URL.
  assert.doesNotMatch(svg.replace(' xmlns="http://www.w3.org/2000/svg"', ""), /https?:|<image|xlink|url\((?!#)/);
});
