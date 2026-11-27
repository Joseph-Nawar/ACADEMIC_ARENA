// Character Studio V2: Create, Wardrobe and Arena Pass.
//
// One studio, two stores:
//   * demo (loopback fictional preview): local storage, fictional reward tools;
//   * server (production, when the owner switches `character_studio_v2` on and
//     a student is signed in): /api/me/character. Ownership is decided by the
//     server and enforced again by the database; lock icons here are only UI.
// Every server answer is tied to the session epoch and a request sequence, so
// a sign-out, an account switch or a late response never lands on the wrong
// account, and saves carry the revision they were based on (stale saves are
// refused by the server instead of overwriting newer work or a reward fallback).
(() => {
  "use strict";

  const C = window.AcademicArenaAvatarCatalog;
  const R = window.AcademicArenaAvatarRenderer;
  const $ = (id) => document.getElementById(id);
  const root = $("studio-v2");
  if (!C || !R || !root) return;

  const KEYS = { character: "arena-v2-demo-character", look: "arena-v2-demo-active-look", grants: "arena-v2-demo-grants", show: "arena-v2-demo-show",
    // Production: which grants this browser already celebrated (collection:period
    // strings only). Cleared on sign-out so a shared device keeps nothing.
    seen: "arena-v2-seen-grants" };
  const read = (key, fallback) => { try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const forget = (key) => { try { localStorage.removeItem(key); } catch {} };
  const clone = (config) => ({ ...config, details: [...config.details] });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const startLook = () => clone(C.normalizeForRender(C.DEFAULT_CONFIG));

  // ---------- state ----------
  let api = null;
  let detail = null;
  let store = null; // "demo" | "server" | null (inactive)
  let epoch = 0; // bumps on every session change
  let loadSeq = 0;
  let saveSeq = 0;
  let busy = false;
  let ownedCollections = new Set(["essentials"]);
  let newItems = [];
  let demoGrants = { collections: [], newItems: [], best: null };
  // Server-confirmed state.
  let saved = null;
  let activeLook = null;
  let revision = 0;
  let classicSaved = null;
  let consent = { leaderboard: false, campusWins: false };
  let publication = null;
  let viewedOnce = false;
  const owned = () => new Set([...ownedCollections].flatMap((name) => C.itemsInCollection(name)));
  const isOwned = (itemKey) => C.items[itemKey].collection === "essentials" || owned().has(itemKey);
  let draft = startLook();
  let history = [clone(draft)];
  let cursor = 0;
  let category = "body";
  let section = "create";
  let frame = "full";
  let wardrobeFilter = "all";
  let wardrobeCollection = "all";
  let toast = "";
  const consentNow = () => ({ leaderboard: $("v2-show-public").checked, campusWins: $("v2-show-wins").checked });
  const consentChanged = () => store === "server" && !same(consentNow(), consent);

  function resetHistory(config) {
    draft = clone(config);
    history = [clone(draft)];
    cursor = 0;
  }

  // ---------- categories ----------
  const S = (field, kind, extra = {}) => ({ field, kind, ...extra });
  const categories = [
    { id: "body", label: "Body", sections: [S("skin", "swatch", { title: "Skin tone" }), S("face", "thumb", { title: "Face shape", context: "portrait" }), S("build", "thumb", { title: "Build", context: "full" })] },
    { id: "hair", label: "Hair", sections: [S("hair", "thumb", { title: "Hairstyle", context: "portrait" }), S("hairColor", "swatch", { title: "Hair colour" })] },
    { id: "eyes", label: "Eyes", sections: [S("eyes", "thumb", { title: "Eye shape", context: "face" }), S("eyeColor", "swatch", { title: "Eye colour" })] },
    { id: "brows", label: "Brows", sections: [S("brows", "thumb", { title: "Eyebrows", context: "face" })] },
    { id: "nose", label: "Nose", sections: [S("nose", "thumb", { title: "Nose", context: "face" })] },
    { id: "mouth", label: "Mouth", sections: [S("mouth", "thumb", { title: "Expression", context: "face" })] },
    { id: "beard", label: "Facial hair", sections: [S("facialHair", "thumb", { title: "Facial hair", context: "portrait" }), S("hairColor", "swatch", { title: "Colour (shared with hair)" })] },
    { id: "makeup", label: "Makeup", sections: [S("liner", "thumb", { title: "Eyes", context: "face" }), S("lips", "swatch", { title: "Lip colour" }), S("blush", "thumb", { title: "Blush", context: "face" })] },
    { id: "details", label: "Details", sections: [S("details", "toggles", { title: "Facial details (up to 3)", context: "portrait" })] },
    { id: "headwear", label: "Head covering", sections: [S("headwear", "thumb", { title: "Head coverings & hats", context: "portrait" }), S("headwearColor", "swatch", { title: "Colour" })] },
    { id: "glasses", label: "Glasses", sections: [S("glasses", "thumb", { title: "Glasses", context: "face" }), S("glassesColor", "swatch", { title: "Frame colour" })] },
    { id: "access", label: "Hearing & mobility", sections: [S("hearing", "thumb", { title: "Hearing", context: "portrait" }), S("mobility", "thumb", { title: "Mobility", context: "full" })] },
    { id: "top", label: "Tops", sections: [S("top", "thumb", { title: "Tops", context: "torso" }), S("topColor", "swatch", { title: "Colour" })] },
    { id: "bottom", label: "Bottoms", sections: [S("bottom", "thumb", { title: "Bottoms", context: "legs" }), S("bottomColor", "swatch", { title: "Colour" })] },
    { id: "shoes", label: "Shoes", sections: [S("shoes", "thumb", { title: "Shoes", context: "legs" }), S("shoesColor", "swatch", { title: "Colour" })] },
    { id: "extras", label: "Extras", sections: [S("neck", "thumb", { title: "Neck", context: "torso" }), S("neckColor", "swatch", { title: "Neck item colour" }), S("back", "thumb", { title: "Bags & capes", context: "full" }), S("backColor", "swatch", { title: "Bag colour" }), S("earrings", "thumb", { title: "Earrings", context: "portrait" })] },
    { id: "scene", label: "Scene", sections: [S("backdrop", "thumb", { title: "Backdrop", context: "portrait", backdrop: true }), S("sticker", "thumb", { title: "Sticker", context: "full", sticker: true })] },
  ];
  const optionLabel = (field, value) => {
    const f = C.fields[field];
    if (f.kind === "item") return C.items[`${f.slot}.${value}`].label;
    const O = C.options;
    const P = C.palettes;
    const tables = { face: O.faceShapes, build: O.builds, eyes: O.eyeShapes, brows: O.brows, nose: O.noses, mouth: O.mouths, facialHair: O.facialHair, blush: O.blush, liner: O.liner };
    if (field === "hair") return O.hairstyles[value].label;
    if (tables[field]) return tables[field][value];
    if (field === "skin") return `Skin tone ${Number(value.slice(1))} of 12`;
    if (field === "hairColor") return P.hairColors[value][0];
    if (field === "eyeColor") return P.eyeColors[value][0];
    if (field === "lips") return P.lipColors[value][0];
    if (field === "glassesColor") return P.frameColors[value][0];
    if (/Color$/.test(field)) return P.clothColors[value][0];
    return value;
  };
  const swatchColor = (field, value) => {
    const P = C.palettes;
    if (field === "skin") return P.skin[Number(value.slice(1)) - 1];
    if (field === "hairColor") return P.hairColors[value][1];
    if (field === "eyeColor") return P.eyeColors[value][1];
    if (field === "lips") return P.lipColors[value][1];
    if (field === "glassesColor") return P.frameColors[value][1];
    return P.clothColors[value][1];
  };
  // Swatches only matter when the item uses them.
  const colorApplies = (field, config) => {
    const slot = { topColor: "top", bottomColor: "bottom", shoesColor: "shoes", headwearColor: "headwear", neckColor: "neck", backColor: "back" }[field];
    if (field === "glassesColor") return config.glasses !== "none";
    if (!slot) return true;
    const item = C.items[`${slot}.${config[slot]}`];
    return item.colorable === true;
  };

  // ---------- rendering helpers ----------
  // Renderer output is built only from catalog constants (see render.js).
  const svgInto = (element, svg) => { element.innerHTML = svg; };
  const thumbCache = new Map();
  function thumb(config, options) {
    const key = JSON.stringify([config, options]);
    if (!thumbCache.has(key)) {
      if (thumbCache.size > 600) thumbCache.clear();
      thumbCache.set(key, R.render(config, { decorative: true, backdrop: false, ...options }));
    }
    return thumbCache.get(key);
  }
  const itemKeyFor = (field, value) => (C.fields[field].kind === "item" ? `${C.fields[field].slot}.${value}` : null);
  const lockedItems = (config) => Object.entries(C.fields).filter(([, f]) => f.kind === "item")
    .map(([field]) => itemKeyFor(field, config[field])).filter((key) => !isOwned(key));
  const describe = (config) => `Custom character: ${optionLabel("skin", config.skin).toLowerCase()}, ${optionLabel("hair", config.hair).toLowerCase()} hair, ${optionLabel("mouth", config.mouth).toLowerCase()} expression, wearing ${optionLabel("top", config.top).toLowerCase()}.`;

  // ---------- edits, history ----------
  function commit(next, message = "") {
    const compat = C.compatibilityErrors(next);
    if (compat.length) {
      next.headwear = "none";
      message = "Hat removed: it doesn't fit over this hairstyle.";
    }
    if (same(next, draft)) return;
    draft = next;
    history.splice(cursor + 1);
    history.push(clone(draft));
    if (history.length > 80) history.shift();
    cursor = history.length - 1;
    toast = message;
    renderAll();
  }
  function setField(field, value) {
    const next = clone(draft);
    if (C.fields[field].kind === "set") {
      const list = new Set(next.details);
      if (list.has(value)) list.delete(value);
      else if (list.size < C.fields.details.max) list.add(value);
      else { toast = "Up to three details at a time."; renderAll(); return; }
      next.details = C.fields.details.values.filter((entry) => list.has(entry));
    } else next[field] = value;
    commit(next);
  }
  function undo() { if (cursor > 0) { draft = clone(history[--cursor]); toast = "Undone."; renderAll(); } }
  function redo() { if (cursor < history.length - 1) { draft = clone(history[++cursor]); toast = "Redone."; renderAll(); } }
  function reset() { commit(clone(saved || C.normalizeForRender(C.DEFAULT_CONFIG)), saved ? "Back to your saved look." : "Back to the starting look."); }

  // Randomize uses only owned items and keeps every combination compatible.
  function randomize() {
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const none = { glasses: 0.55, hearing: 0.85, mobility: 0.85, headwear: 0.6, facialHair: 0.55, neck: 0.6, back: 0.6, earrings: 0.6, liner: 0.6, lips: 0.6, blush: 0.6 };
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const next = { v: C.SCHEMA_VERSION };
      for (const [field, f] of Object.entries(C.fields)) {
        if (f.kind === "set") { next.details = f.values.filter(() => Math.random() < 0.12).slice(0, 2); continue; }
        let values = f.values;
        if (f.kind === "item") values = values.filter((value) => isOwned(`${f.slot}.${value}`));
        const some = values.filter((value) => value !== "none");
        next[field] = none[field] && (Math.random() < none[field] || !some.length) ? "none" : pick(none[field] ? some : values);
      }
      if (C.validateConfig(next, { ownedItems: owned() }).ok) return commit(next, "Shuffled! Undo brings back the last look.");
    }
  }

  // ---------- save ----------
  function lockedMessage(errors) {
    const locked = errors.filter((error) => error.code === "not_owned");
    if (!locked.length) return "This look can't be saved. Try another combination.";
    const names = locked.map((error) => `${C.items[error.item].label} (${C.collections[C.items[error.item].collection].rule.replace(/\.$/, "")})`);
    return `Can't save yet: ${names.join(", ")} ${locked.length > 1 ? "are" : "is"} locked. Remove ${locked.length > 1 ? "them" : "it"} to save, or earn ${locked.length > 1 ? "them" : "it"} first.`;
  }

  async function save() {
    const result = C.validateConfig(draft, { ownedItems: owned() });
    if (!result.ok) { toast = lockedMessage(result.errors); renderAll(); return; }
    if (store === "demo") {
      if (!write(KEYS.character, result.config)) { toast = "This browser couldn't store the fictional look."; renderAll(); return; }
      write(KEYS.look, "v2");
      write(KEYS.show, $("v2-show-public").checked);
      saved = clone(result.config);
      activeLook = "v2";
      toast = "Saved in this browser (fictional preview: nothing is published).";
      renderAll();
      return;
    }
    await sendToServer({ activeLook: "v2", v2: saved && same(saved, result.config) ? null : result.config }, "Saved. Your character is updated everywhere it is shown.");
  }

  // One write path for the server store. The result is applied only if the
  // session is unchanged and no newer save started meanwhile.
  async function sendToServer(change, success) {
    if (busy) return;
    const at = epoch;
    const mine = ++saveSeq;
    busy = true;
    renderPreview();
    try {
      const state = await api.student.saveCharacterV2({
        expectedRevision: revision, activeLook: change.activeLook, v2: change.v2,
        showOnLeaderboard: $("v2-show-public").checked, showOnCampusWins: $("v2-show-wins").checked,
      });
      if (at !== epoch || mine !== saveSeq) return;
      loadSeq += 1; // the save's answer supersedes any load still in flight
      if (state.stale) { toast = success; await loadServer({ keepDraft: true }); return; }
      applyServerState(state, { keepDraft: true });
      toast = success;
      detail?.refreshBoard?.();
      // The classic studio shares the leaderboard consent: let it re-read.
      window.dispatchEvent(new CustomEvent("arena:v2-saved"));
    } catch (error) {
      if (at !== epoch || mine !== saveSeq) return;
      if (error?.code === "unauthorized") { detail?.sessionEnded?.("Your session has ended. Sign in again to save your character."); return; }
      toast = {
        character_changed: "Your character changed somewhere else (another tab or device, or a results correction). We loaded the latest saved version; your edits are still here. Check them and save again.",
        item_not_owned: "One of these items isn't in your Wardrobe any more (rewards can be corrected when results are). Remove it to save.",
        studio_not_enabled: "Custom characters are switched off right now. Your classic look is unchanged.",
      }[error?.code] || "Your character could not be saved. Try again later.";
      if (["character_changed", "item_not_owned"].includes(error?.code)) await loadServer({ keepDraft: true, quiet: true });
    } finally {
      if (at === epoch && mine === saveSeq) busy = false;
      if (at === epoch) renderAll();
    }
  }

  // ---------- DOM: preview ----------
  function renderPreview() {
    const stage = $("v2-stage");
    stage.dataset.frame = frame;
    if (frame === "board") {
      svgInto($("v2-stage-art"), "");
      const board = $("v2-stage-board");
      board.hidden = false;
      svgInto(board.querySelector(".v2-board-podium"), R.render(draft, { context: "full", backdrop: false, decorative: true }));
      svgInto(board.querySelector(".v2-board-thumb"), R.render(draft, { context: "portrait", decorative: true }));
    } else {
      $("v2-stage-board").hidden = true;
      svgInto($("v2-stage-art"), R.render(draft, { context: frame, title: describe(draft), sticker: frame === "full" ? undefined : false }));
    }
    document.querySelectorAll("[data-frame]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.frame === frame)));
    const lookDirty = !saved || !same(saved, draft);
    const notShown = store === "server" && saved && activeLook !== "v2";
    const dirty = lookDirty || consentChanged() || notShown;
    $("v2-dirty").hidden = !dirty;
    $("v2-dirty").textContent = !saved ? "● NOT SAVED YET" : lookDirty || consentChanged() ? "● UNSAVED CHANGES" : "● SAVED · NOT IN USE";
    $("v2-saved").hidden = dirty;
    const locked = lockedItems(draft);
    const note = $("v2-locked-note");
    note.hidden = locked.length === 0;
    note.textContent = locked.length
      ? `Previewing locked: ${locked.map((key) => `${C.items[key].label} (${C.collections[C.items[key].collection].rule.replace(/\.$/, "")})`).join(", ")}. You can try it on, but you can only save items you own.`
      : "";
    $("v2-save").disabled = busy || locked.length > 0 || !dirty;
    $("v2-save").setAttribute("aria-busy", String(busy));
    $("v2-save").textContent = busy ? "SAVING…" : notShown && !lookDirty && !consentChanged() ? "USE THIS LOOK ↗" : "SAVE LOOK ↗";
    renderPublicState();
    $("v2-undo").disabled = cursor === 0;
    $("v2-redo").disabled = cursor >= history.length - 1;
    $("v2-toast").textContent = toast;
  }

  // ---------- DOM: create ----------
  function renderCategories() {
    const bar = $("v2-cats");
    if (!bar.childElementCount) {
      for (const cat of categories) {
        const button = document.createElement("button");
        button.type = "button";
        button.role = "tab";
        button.id = `v2-cat-${cat.id}`;
        button.className = "v2-cat";
        button.dataset.cat = cat.id;
        button.setAttribute("aria-controls", "v2-options");
        button.textContent = cat.label;
        button.addEventListener("click", () => { category = cat.id; toast = ""; renderAll(); });
        bar.append(button);
      }
      bar.addEventListener("keydown", (event) => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = categories.findIndex((cat) => cat.id === category);
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? categories.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + categories.length) % categories.length;
        category = categories[nextIndex].id;
        renderAll();
        $(`v2-cat-${category}`).focus();
      });
    }
    for (const button of bar.children) {
      const active = button.dataset.cat === category;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      // Keep the active chip visible by scrolling only the bar, never the page.
      if (active && bar.dataset.scrolled !== category) {
        const left = button.offsetLeft - bar.offsetLeft;
        if (left < bar.scrollLeft || left + button.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = left - 8;
        bar.dataset.scrolled = category;
      }
    }
    $("v2-options").setAttribute("aria-labelledby", `v2-cat-${category}`);
  }

  function optionButton({ selected, label, locked, unlock, disabled, reason, onClick, svg, swatch }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = swatch ? "v2-swatch" : "v2-option";
    button.setAttribute("aria-pressed", String(selected));
    const fullLabel = `${label}${locked ? ` (locked: ${unlock?.rule || "preview only"} Try it on, but you can't save it yet.)` : ""}${disabled ? ` (${reason})` : ""}`;
    button.setAttribute("aria-label", fullLabel);
    button.title = fullLabel;
    if (disabled) button.setAttribute("aria-disabled", "true");
    if (swatch) {
      if (swatch.color) button.style.setProperty("--swatch", swatch.color);
      else button.classList.add("v2-swatch-none");
    } else {
      const art = document.createElement("span");
      art.className = "v2-option-art";
      svgInto(art, svg);
      const name = document.createElement("span");
      name.className = "v2-option-name";
      name.textContent = label;
      button.append(art, name);
      if (locked) {
        const lock = document.createElement("span");
        lock.className = "v2-lock";
        lock.setAttribute("aria-hidden", "true");
        lock.textContent = "🔒";
        // The requirement in words, so it never depends on colour.
        const tag = document.createElement("span");
        tag.className = "v2-unlock-tag";
        tag.setAttribute("aria-hidden", "true");
        tag.textContent = unlock?.unlock || "LOCKED";
        button.append(lock, tag);
      }
    }
    button.addEventListener("click", () => {
      if (disabled) { toast = `${label}: ${reason}.`; renderAll(); return; }
      onClick();
    });
    return button;
  }

  function renderOptions() {
    const container = $("v2-options");
    container.replaceChildren();
    const cat = categories.find((entry) => entry.id === category);
    for (const sec of cat.sections) {
      if (sec.kind === "swatch" && !colorApplies(sec.field, draft)) continue;
      const block = document.createElement("div");
      block.className = "v2-section";
      const head = document.createElement("h3");
      head.textContent = sec.title;
      const grid = document.createElement("div");
      grid.className = sec.kind === "swatch" ? "v2-swatches" : "v2-grid";
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", sec.title);
      const field = C.fields[sec.field];
      for (const value of field.values) {
        const itemKey = itemKeyFor(sec.field, value);
        if (sec.kind === "swatch") {
          grid.append(optionButton({ selected: draft[sec.field] === value, label: optionLabel(sec.field, value), swatch: { color: swatchColor(sec.field, value) }, onClick: () => setField(sec.field, value) }));
          continue;
        }
        const preview = clone(draft);
        if (sec.kind === "toggles") preview.details = draft.details.includes(value) ? draft.details : [...draft.details, value].slice(-3);
        else preview[sec.field] = value;
        const incompatible = C.compatibilityErrors(preview).length > 0;
        const locked = itemKey ? !isOwned(itemKey) : false;
        const selected = sec.kind === "toggles" ? draft.details.includes(value) : draft[sec.field] === value;
        const label = sec.kind === "toggles" ? C.options.details[value] : optionLabel(sec.field, value);
        grid.append(optionButton({
          selected, label, locked, unlock: itemKey ? C.collections[C.items[itemKey].collection] : null,
          disabled: incompatible, reason: "doesn't fit over this hairstyle",
          svg: thumb(incompatible ? { ...preview, headwear: "none" } : preview, { context: sec.context, backdrop: sec.backdrop === true, sticker: sec.sticker ? true : false }),
          onClick: () => setField(sec.field, value),
        }));
      }
      block.append(head, grid);
      container.append(block);
    }
  }

  // ---------- DOM: wardrobe ----------
  const slotContext = { headwear: "portrait", glasses: "face", hearing: "portrait", earrings: "portrait", mobility: "full", top: "torso", bottom: "legs", shoes: "legs", neck: "torso", back: "full", backdrop: "portrait", sticker: "full" };
  const slotField = (slot) => Object.keys(C.fields).find((field) => C.fields[field].slot === slot);
  function renderWardrobe() {
    const grid = $("v2-wardrobe-grid");
    grid.replaceChildren();
    const ownedSet = owned();
    const keys = Object.keys(C.items).filter((key) => !key.endsWith(".none"))
      .filter((key) => wardrobeCollection === "all" || C.items[key].collection === wardrobeCollection)
      .filter((key) => {
        const ownedItem = C.items[key].collection === "essentials" || ownedSet.has(key);
        const equipped = draft[slotField(C.items[key].slot)] === key.split(".")[1];
        return wardrobeFilter === "all" || (wardrobeFilter === "owned" && ownedItem) || (wardrobeFilter === "locked" && !ownedItem) || (wardrobeFilter === "equipped" && equipped);
      })
      .sort((a, b) => C.collections[C.items[a].collection].order - C.collections[C.items[b].collection].order);
    const counts = { all: 0, owned: 0, locked: 0 };
    for (const key of Object.keys(C.items).filter((entry) => !entry.endsWith(".none"))) {
      counts.all += 1;
      if (C.items[key].collection === "essentials" || ownedSet.has(key)) counts.owned += 1; else counts.locked += 1;
    }
    $("v2-wardrobe-summary").textContent = `${counts.owned} owned · ${counts.locked} locked · ${counts.all} in the catalogue`;
    for (const key of keys) {
      const item = C.items[key];
      const field = slotField(item.slot);
      const value = key.split(".")[1];
      const ownedItem = item.collection === "essentials" || ownedSet.has(key);
      const equipped = draft[field] === value;
      const isNew = newItems.includes(key);
      const card = document.createElement("article");
      card.className = "v2-item";
      card.dataset.rarity = item.rarity;
      card.dataset.owned = String(ownedItem);
      const art = document.createElement("div");
      art.className = "v2-item-art";
      const preview = { ...clone(draft), [field]: value };
      if (C.compatibilityErrors(preview).length) preview.hair = "crop";
      svgInto(art, thumb(preview, { context: slotContext[item.slot], backdrop: item.slot === "backdrop", sticker: item.slot === "sticker" }));
      const name = document.createElement("h4");
      name.textContent = item.label;
      const meta = document.createElement("p");
      meta.className = "v2-item-meta";
      // Rarity and ownership are always spelled out, never colour alone.
      meta.textContent = `${{ common: "○", rare: "◆", epic: "✦", legendary: "★" }[item.rarity]} ${C.rarities[item.rarity]} · ${C.collections[item.collection].label}`;
      const status = document.createElement("p");
      status.className = "v2-item-status";
      status.textContent = equipped ? "EQUIPPED" : ownedItem ? "OWNED" : `🔒 ${C.collections[item.collection].rule}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = ownedItem ? "button-solid v2-item-action" : "v2-item-action v2-try";
      button.textContent = equipped ? "WEARING" : ownedItem ? "EQUIP" : "TRY ON";
      button.disabled = equipped;
      button.setAttribute("aria-label", `${button.textContent} ${item.label}${ownedItem ? "" : " (locked, preview only)"}`);
      button.addEventListener("click", () => {
        const next = { ...clone(draft), [field]: value };
        if (C.compatibilityErrors(next).length) next.hair = "crop";
        newItems = newItems.filter((entry) => entry !== key);
        if (store === "demo") { demoGrants.newItems = newItems; write(KEYS.grants, demoGrants); }
        commit(next, ownedItem ? `${item.label} equipped.` : `Trying on ${item.label}. Locked items can't be saved.`);
      });
      if (isNew) {
        const badge = document.createElement("span");
        badge.className = "v2-new-badge";
        badge.textContent = "NEW";
        card.append(badge);
      }
      card.append(art, name, meta, status, button);
      grid.append(card);
    }
    if (!keys.length) {
      const empty = document.createElement("p");
      empty.className = "v2-empty";
      empty.textContent = "Nothing here yet.";
      grid.append(empty);
    }
    document.querySelectorAll("[data-wfilter]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.wfilter === wardrobeFilter)));
    document.querySelectorAll("[data-wcollection]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.wcollection === wardrobeCollection)));
    const newCount = newItems.length;
    $("v2-new-count").hidden = newCount === 0;
    $("v2-new-count").textContent = String(newCount);
  }

  // ---------- DOM: Arena Pass (fictional) ----------
  const PASS = {
    name: "SEASON 0 · CIRCUIT",
    xp: 430,
    perTier: 100,
    tiers: [
      ["sticker.code", "Starter sticker"], ["backdrop.night", "Night study"], ["sticker.book", "Book sticker"], ["sticker.circuit", "Circuit chip"],
      ["backdrop.circuit", "Circuit grid"], ["headwear.circuitcap", "Circuit cap"], ["back.circuitpack", "Circuit pack"], ["top.circuithoodie", "Circuit hoodie"],
    ],
  };
  function renderPass() {
    const track = $("v2-pass-track");
    if (store !== "demo") {
      // Production: nothing is tracked until the Director approves XP rules.
      track.replaceChildren();
      $("v2-pass-name").textContent = "ARENA PASS";
      $("v2-pass-level").textContent = "NOT ACTIVE YET";
      $("v2-pass-bar").style.setProperty("--progress", "0%");
      const strong = document.createElement("strong");
      strong.textContent = "NOT SWITCHED ON";
      $("v2-pass-banner").replaceChildren(strong, "Arena Pass isn't active. No XP is earned or tracked until the earning rules are approved. Your verified rewards are in the Wardrobe.");
      return;
    }
    if (track.childElementCount) return;
    const level = Math.floor(PASS.xp / PASS.perTier);
    $("v2-pass-name").textContent = PASS.name;
    $("v2-pass-level").textContent = `TIER ${level} · ${PASS.xp % PASS.perTier}/${PASS.perTier} XP TO TIER ${level + 1}`;
    $("v2-pass-bar").style.setProperty("--progress", `${Math.min(100, (PASS.xp / (PASS.perTier * PASS.tiers.length)) * 100)}%`);
    PASS.tiers.forEach(([key, label], index) => {
      const tier = index + 1;
      const earned = tier <= level;
      const li = document.createElement("li");
      li.className = "v2-tier";
      li.dataset.state = earned ? "earned" : tier === level + 1 ? "next" : "upcoming";
      const number = document.createElement("span");
      number.className = "v2-tier-num";
      number.textContent = `TIER ${tier}`;
      const art = document.createElement("div");
      art.className = "v2-tier-art";
      const item = C.items[key];
      const field = slotField(item.slot);
      svgInto(art, thumb({ ...C.normalizeForRender(C.DEFAULT_CONFIG), [field]: key.split(".")[1] }, { context: slotContext[item.slot], backdrop: item.slot === "backdrop", sticker: item.slot === "sticker" }));
      const name = document.createElement("strong");
      name.textContent = label;
      const state = document.createElement("span");
      state.className = "v2-tier-state";
      state.textContent = earned ? "✓ EARNED (DEMO)" : tier === level + 1 ? "NEXT UP" : `${tier * PASS.perTier} XP`;
      li.append(number, art, name, state);
      li.setAttribute("aria-label", `Tier ${tier}: ${label}, ${state.textContent.toLowerCase()}`);
      track.append(li);
    });
  }

  // ---------- celebration ----------
  let celebrateReturn = null;
  function celebrate(newCollections, items) {
    const dialog = $("v2-celebrate");
    $("v2-celebrate-title").textContent = newCollections.length > 1 ? `${newCollections.length} COLLECTIONS UNLOCKED!` : "REWARD UNLOCKED!";
    $("v2-celebrate-text").textContent = `${newCollections.map((name) => C.collections[name].label).join(" + ")}: ${items.length} new items are in your Wardrobe. Rewards you earn stay yours.`;
    const row = $("v2-celebrate-items");
    row.replaceChildren();
    const rank = { legendary: 0, epic: 1, rare: 2, common: 3 };
    const headline = [...items].sort((a, b) => rank[C.items[a].rarity] - rank[C.items[b].rarity]);
    for (const key of headline.slice(0, 5)) {
      const item = C.items[key];
      const cell = document.createElement("span");
      cell.className = "v2-celebrate-item";
      cell.dataset.rarity = item.rarity;
      svgInto(cell, thumb({ ...clone(draft), [slotField(item.slot)]: key.split(".")[1], hair: C.items[key].fit === "fitted" ? "crop" : draft.hair }, { context: slotContext[item.slot], backdrop: item.slot === "backdrop", sticker: item.slot === "sticker" }));
      row.append(cell);
    }
    const confetti = $("v2-confetti");
    confetti.replaceChildren();
    if (!reduceMotion()) for (let i = 0; i < 36; i += 1) {
      const bit = document.createElement("i");
      bit.style.setProperty("--x", `${(i * 37) % 100}%`);
      bit.style.setProperty("--d", `${(i % 7) * 0.12}s`);
      bit.style.setProperty("--c", ["#f4c856", "#ef6f56", "#76bbb1", "#2e4a7d"][i % 4]);
      confetti.append(bit);
    }
    $("v2-announce").textContent = `Reward unlocked. ${$("v2-celebrate-text").textContent}`;
    celebrateReturn = document.activeElement;
    dialog.hidden = false;
    $("v2-celebrate-open").focus();
  }
  function closeCelebrate() {
    $("v2-celebrate").hidden = true;
    celebrateReturn?.focus?.();
  }

  // Demo only: simulate a verified finish to show what entitlements unlock.
  function simulateFinish(position) {
    const earned = C.collectionsForPosition(position);
    const fresh = earned.filter((name) => !demoGrants.collections.includes(name));
    if (!fresh.length) { toast = position ? "Those collections are already in your Wardrobe. Rewards are never granted twice." : ""; renderAll(); return; }
    const items = fresh.flatMap((name) => C.itemsInCollection(name));
    demoGrants.collections = [...new Set([...demoGrants.collections, ...fresh])];
    demoGrants.newItems = [...new Set([...demoGrants.newItems, ...items])];
    write(KEYS.grants, demoGrants);
    applyDemoGrants();
    renderAll();
    celebrate(fresh, items);
  }

  function applyDemoGrants() {
    ownedCollections = new Set(["essentials", ...demoGrants.collections.filter((name) => Object.hasOwn(C.collections, name))]);
    newItems = [...demoGrants.newItems];
  }

  // ---------- section switching ----------
  function renderSections() {
    for (const name of ["create", "wardrobe", "pass"]) {
      const tab = $(`v2-tab-${name}`);
      tab.setAttribute("aria-selected", String(section === name));
      tab.tabIndex = section === name ? 0 : -1;
      $(`v2-${name}`).hidden = section !== name;
    }
  }

  function renderAll() {
    renderSections();
    renderPreview();
    if (section === "create") { renderCategories(); renderOptions(); }
    if (section === "wardrobe") renderWardrobe();
    if (section === "pass") renderPass();
    if (section !== "wardrobe") {
      $("v2-new-count").hidden = newItems.length === 0;
      $("v2-new-count").textContent = String(newItems.length);
    }
  }

  // ---------- look switch (classic vs custom) ----------
  // Which editor is open. In production the look that is *shown* is the one
  // the server confirms (activeLook); opening an editor changes nothing.
  let editor = "v2";
  function applyLook(look) {
    editor = look === "classic" ? "classic" : "v2";
    const v2 = editor === "v2";
    root.hidden = !v2;
    $("studio-classic").hidden = v2;
    document.querySelectorAll("[data-look]").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.look === editor)));
    const shown = store === "server" ? activeLook : saved ? "v2" : null;
    $("look-switch-note").textContent = store === "server"
      ? (shown === "v2" ? "Your custom look is the one shown." + (classicSaved ? " Your classic look stays saved." : "")
        : shown === "classic" ? (v2 ? "Your classic look is the one shown. Save a custom look to use it instead; your classic look stays saved." : "Your classic look is the one shown.")
        : "Nothing is saved yet. Build a custom look or pick a classic one.")
      : v2
        ? (saved ? "Your custom look is the one you use. Your classic look stays saved." : "Build a custom look. Your classic look stays saved and you can switch back any time.")
        : "Using your classic look. Your custom look stays saved.";
    $("look-use-classic").hidden = !(store === "server" && activeLook === "v2" && classicSaved);
  }

  // The header portrait uses the same renderer when the custom look is shown.
  function headerPortrait() {
    const frameEl = document.querySelector(".mini-photo");
    if (!frameEl) return;
    let art = frameEl.querySelector(":scope > .mini-v2");
    const show = store === "server" && activeLook === "v2" && saved;
    frameEl.classList.toggle("has-v2", Boolean(show));
    if (!show) { art?.remove(); return; }
    if (!art) {
      art = document.createElement("span");
      art.className = "mini-v2";
      frameEl.append(art);
    }
    svgInto(art, R.render(saved, { context: "portrait", decorative: true }));
  }

  // ---------- public status (server truth only) ----------
  const PUBLIC_COPY = Object.freeze({
    not_saved: ["NOT SAVED YET", "Nothing is saved or public yet."],
    saved_private: ["SAVED PRIVATELY", "Only you can see it. Public characters aren't switched on yet."],
    display_off: ["PUBLIC DISPLAY OFF", "Saved to your account. Leaderboards show the default character for your rank."],
    awaiting_link: ["PUBLIC DISPLAY ON · NOT SHOWN YET", "It appears once you are in a published top 10 and staff have verified which ranking is yours."],
    public: ["PUBLIC NOW", "Your shown look is on the current leaderboard. Saved changes appear the next time anyone loads it."],
    unknown: ["STATUS UNAVAILABLE", "We couldn't check whether your character is public. Try again later."],
  });
  function renderPublicState() {
    const panel = $("v2-public-state");
    panel.hidden = store !== "server" || !publication;
    if (panel.hidden) return;
    const [label, text] = PUBLIC_COPY[publication] || PUBLIC_COPY.unknown;
    if (panel.dataset.state !== publication) {
      panel.dataset.state = publication;
      $("v2-public-state-label").textContent = label;
      $("v2-public-state-text").textContent = text;
    }
  }

  // ---------- server store ----------
  function seenGrants() { const list = read(KEYS.seen, []); return new Set(Array.isArray(list) ? list.filter((entry) => typeof entry === "string") : []); }
  function applyServerState(state, { keepDraft = false, first = false } = {}) {
    ownedCollections = new Set(state.owned);
    const previousSaved = saved;
    saved = state.v2 ? clone(state.v2) : null;
    activeLook = state.activeLook;
    revision = state.revision;
    classicSaved = state.classic;
    publication = state.publication;
    // Keep edits in progress; otherwise show what is saved now.
    const untouched = cursor === 0 && history.length === 1 && (!previousSaved ? same(draft, startLook()) : same(draft, previousSaved));
    if (!keepDraft || untouched) resetHistory(saved || startLook());
    const consentUntouched = same(consentNow(), consent);
    consent = { leaderboard: state.showOnLeaderboard, campusWins: state.showOnCampusWins };
    if (!keepDraft || consentUntouched) {
      $("v2-show-public").checked = consent.leaderboard;
      $("v2-show-wins").checked = consent.campusWins;
    }
    // Newly granted collections (last 14 days, not yet seen here): NEW badges
    // and one celebration.
    const seen = seenGrants();
    const recent = state.grants.filter((grant) => !seen.has(`${grant.collection}:${grant.period}`) &&
      Date.now() - Date.parse(grant.grantedAt) < 14 * 24 * 3600 * 1000);
    const fresh = [...new Set(recent.map((grant) => grant.collection))];
    newItems = [...new Set([...newItems.filter((key) => owned().has(key)), ...fresh.flatMap((name) => C.itemsInCollection(name))])];
    if (fresh.length) pendingCelebration = { fresh, keys: recent.map((grant) => `${grant.collection}:${grant.period}`) };
    if (first) applyLook(activeLook === "classic" ? "classic" : "v2");
    else applyLook(editor);
    headerPortrait();
    renderAll();
    maybeCelebrate();
  }

  // A real grant is celebrated once, when the student is actually looking at
  // My Character (rewards are custom-look items, so the custom editor opens).
  let pendingCelebration = null;
  function maybeCelebrate() {
    if (!pendingCelebration || store !== "server" || $("page-avatar")?.hidden !== false) return;
    const { fresh, keys } = pendingCelebration;
    pendingCelebration = null;
    write(KEYS.seen, [...seenGrants(), ...keys].slice(-100));
    applyLook("v2");
    celebrate(fresh, fresh.flatMap((name) => C.itemsInCollection(name)));
  }

  async function loadServer({ keepDraft = false, first = false, quiet = false } = {}) {
    const at = epoch;
    const mine = ++loadSeq;
    try {
      const state = await api.student.getCharacterV2();
      if (at !== epoch || mine !== loadSeq) return;
      if (!state.studioEnabled) { deactivate(); return; }
      applyServerState(state, { keepDraft, first });
    } catch (error) {
      if (at !== epoch || mine !== loadSeq) return;
      if (error?.code === "unauthorized") { detail?.sessionEnded?.(); return; }
      if (!quiet) toast = "Your custom character couldn't be loaded. Try again later.";
      renderAll();
    }
  }

  async function useClassic() {
    if (!classicSaved) return;
    await sendToServer({ activeLook: "classic", v2: null }, "Your classic look is shown again. Your custom look stays saved.");
    applyLook("classic");
  }

  // ---------- activation per session ----------
  let wired = false;
  function deactivate() {
    const wasServer = store === "server";
    store = null;
    busy = false;
    saved = null; activeLook = null; revision = 0; classicSaved = null; publication = null;
    consent = { leaderboard: false, campusWins: false };
    ownedCollections = new Set(["essentials"]);
    newItems = [];
    resetHistory(startLook());
    $("v2-show-public").checked = false;
    $("v2-show-wins").checked = false;
    if (wasServer) forget(KEYS.seen);
    pendingCelebration = null;
    $("v2-celebrate").hidden = true;
    root.hidden = true;
    $("look-switch").hidden = true;
    $("look-use-classic").hidden = true;
    $("studio-classic").hidden = false;
    headerPortrait();
  }

  function eligible(next) {
    if (!next?.api) return null;
    if (next.api.mode === "demo") return "demo";
    const session = next.session || {};
    const features = next.features?.() || {};
    return session.authenticated === true && session.user?.role === "student" && session.user?.mustChangePassword !== true &&
      features.studentSignIn === true && features.characterStudioV2 === true ? "server" : null;
  }

  function onSession(next) {
    detail = next;
    api = next.api;
    const target = eligible(next);
    epoch += 1;
    if (target === "demo") {
      if (store === "demo") return;
      store = "demo";
      wire();
      demoCopy();
      demoGrants = read(KEYS.grants, { collections: [], newItems: [], best: null });
      applyDemoGrants();
      const raw = read(KEYS.character, null);
      const check = raw ? C.validateConfig(raw, { ownedItems: owned() }) : null;
      saved = check?.ok ? check.config : null;
      activeLook = saved ? "v2" : null;
      resetHistory(saved || startLook());
      $("v2-show-public").checked = read(KEYS.show, false) === true;
      $("v2-demo-tools").hidden = false;
      $("look-switch").hidden = false;
      applyLook(read(KEYS.look, "v2") === "classic" ? "classic" : "v2");
      renderAll();
      return;
    }
    if (target !== "server") { if (store) deactivate(); return; }
    // A new session (sign-in or account switch) starts clean, then loads.
    deactivate();
    store = "server";
    wire();
    $("look-switch").hidden = false;
    applyLook("v2");
    renderAll();
    void loadServer({ first: true });
  }

  // ---------- wiring ----------
  // Demo-only copy lives here, so the production page never carries it.
  function demoCopy() {
    const banner = $("v2-pass-banner");
    const strong = document.createElement("strong");
    strong.textContent = "PREVIEW · FICTIONAL DATA";
    banner.replaceChildren(strong, "XP earning isn't switched on. The rules (attendance, quizzes, workshops, improvement, weekly challenges) need approval first. Nothing here is saved, and the pass will always be free for every student.");
    const tools = $("v2-demo-tools");
    if (tools.childElementCount) return;
    const title = document.createElement("strong");
    title.textContent = "FICTIONAL DEMO TOOLS";
    const label = document.createElement("label");
    const select = document.createElement("select");
    select.id = "v2-simulate";
    for (const [value, text] of [["", "Choose…"], ["7", "7th place (Top 10)"], ["3", "3rd place (Top 3)"], ["1", "1st place"]]) select.append(new Option(text, value));
    label.append("Simulate a verified finish ", select);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.id = "v2-demo-clear";
    clear.textContent = "CLEAR FICTIONAL REWARDS";
    const note = document.createElement("span");
    note.textContent = "On the real site, staff-verified rankings grant rewards on the server.";
    tools.replaceChildren(title, label, clear, note);
    select.addEventListener("change", (event) => { const value = Number(event.target.value); event.target.value = ""; if (value) simulateFinish(value); });
    clear.addEventListener("click", () => { demoGrants = { collections: [], newItems: [], best: null }; write(KEYS.grants, demoGrants); applyDemoGrants(); toast = "Fictional rewards cleared."; renderAll(); });
  }

  function wire() {
    if (wired) return;
    wired = true;
    $("avatar-title").innerHTML = "BE<br/><span>YOURSELF.</span>";
    $("avatar-lede").textContent = "Build a character from hundreds of options: skin, hair, features, head coverings, glasses, hearing and mobility aids, and clothes. Everything about who you are is free. Special editions are earned through verified achievements.";
    document.querySelectorAll("[data-look]").forEach((button) => button.addEventListener("click", () => {
      if (store === "demo") write(KEYS.look, button.dataset.look);
      applyLook(button.dataset.look);
      if (button.dataset.look === "v2") renderAll();
    }));
    $("look-use-classic").addEventListener("click", () => void useClassic());
    for (const name of ["create", "wardrobe", "pass"]) $(`v2-tab-${name}`).addEventListener("click", () => { section = name; toast = ""; renderAll(); });
    $("v2-sections").addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowLeft"].includes(event.key)) return;
      const order = ["create", "wardrobe", "pass"];
      section = order[(order.indexOf(section) + (event.key === "ArrowRight" ? 1 : 2)) % 3];
      renderAll();
      $(`v2-tab-${section}`).focus();
    });
    document.querySelectorAll("[data-frame]").forEach((button) => button.addEventListener("click", () => { frame = button.dataset.frame; renderPreview(); }));
    $("v2-undo").addEventListener("click", undo);
    $("v2-redo").addEventListener("click", redo);
    $("v2-random").addEventListener("click", randomize);
    $("v2-reset").addEventListener("click", reset);
    $("v2-save").addEventListener("click", () => void save());
    root.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.target.matches("input, textarea")) return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    });
    document.querySelectorAll("[data-wfilter]").forEach((button) => button.addEventListener("click", () => { wardrobeFilter = button.dataset.wfilter; renderWardrobe(); }));
    const collectionBar = $("v2-collections");
    for (const [name, info] of [["all", { label: "All collections" }], ...Object.entries(C.collections).sort((a, b) => a[1].order - b[1].order)]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "v2-chip";
      button.dataset.wcollection = name;
      button.textContent = info.label + (info.inactive ? " · not active" : "");
      button.addEventListener("click", () => { wardrobeCollection = name; renderWardrobe(); });
      collectionBar.append(button);
    }
    for (const id of ["v2-show-public", "v2-show-wins"]) $(id).addEventListener("change", () => {
      if (store === "demo") { write(KEYS.show, $("v2-show-public").checked); toast = "Saved your choice in this browser (fictional preview)."; }
      else toast = "Save to apply your choice.";
      renderPreview();
    });
    $("v2-celebrate-open").addEventListener("click", () => { closeCelebrate(); section = "wardrobe"; wardrobeFilter = "owned"; renderAll(); });
    $("v2-celebrate-close").addEventListener("click", closeCelebrate);
    // Non-modal: Escape closes it; Tab moves on to the page as usual.
    $("v2-celebrate").addEventListener("keydown", (event) => { if (event.key === "Escape") closeCelebrate(); });
    // A classic save elsewhere on the page changes which look is shown.
    window.addEventListener("arena:classic-saved", () => { if (store === "server") void loadServer({ keepDraft: true, quiet: true }); });
    // Re-read when My Character is opened again (another device may have saved).
    document.querySelectorAll('[data-page="avatar"]').forEach((link) => link.addEventListener("click", () => {
      if (store === "server" && viewedOnce) void loadServer({ keepDraft: true, quiet: true });
      viewedOnce = true;
      maybeCelebrate();
    }));
  }

  window.addEventListener("arena:session", (event) => onSession(event.detail));
  const announced = window.AcademicArenaSession?.latest?.();
  if (announced) onSession(announced);
})();
