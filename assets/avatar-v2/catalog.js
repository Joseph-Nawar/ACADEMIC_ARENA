// Academic Arena Character V2: the approved, trusted catalog.
//
// Pure data (JSON-serializable) shared by the studio, the renderer, the BFF
// validator and the contract tests. A saved character is a small object of
// catalog keys; nothing in it is ever drawn as markup, a URL or CSS. Adding an
// item means adding a key here and its drawing in render.js; the asset test
// fails until both exist.
//
// Collections: "essentials" is free for every student and holds every
// identity-related option (skin, hair, features, head coverings, assistive
// devices, essential clothing). Only decorative special editions belong to a
// reward collection.
(function attachAvatarCatalog(root) {
  "use strict";

  const SCHEMA_VERSION = 2;

  // 12 skin tones, light through deep. Labels are neutral numbers only.
  const skin = [
    "#FBE2D2", "#F5D0B8", "#EEC09F", "#E2AA85", "#D69870", "#C7845A",
    "#B47049", "#9B5B37", "#82482B", "#6A3923", "#53301F", "#3E2419",
  ];
  const hairColors = {
    h01: ["Black", "#211B1D"], h02: ["Soft black", "#30262A"], h03: ["Dark brown", "#4A3226"], h04: ["Brown", "#6B4630"],
    h05: ["Chestnut", "#8A5232"], h06: ["Auburn", "#9A4026"], h07: ["Copper", "#C0652F"], h08: ["Strawberry", "#D8966A"],
    h09: ["Golden", "#D8AE62"], h10: ["Ash blonde", "#C8B494"], h11: ["Platinum", "#ECE2D0"], h12: ["Silver grey", "#A9A7A6"],
    h13: ["Blue", "#3F6FC2"], h14: ["Pink", "#E07AA8"], h15: ["Purple", "#7A55B8"], h16: ["Teal", "#2F9C93"],
  };
  const eyeColors = {
    e01: ["Deep brown", "#3A2316"], e02: ["Brown", "#5E3B21"], e03: ["Hazel", "#7D6A32"], e04: ["Amber", "#A8742B"],
    e05: ["Green", "#4F7F4A"], e06: ["Grey green", "#6D8A7A"], e07: ["Blue", "#4D7BB5"], e08: ["Grey", "#7F8C99"],
    e09: ["Light blue", "#7FB2D9"], e10: ["Near black", "#22150F"],
  };
  const clothColors = {
    c01: ["Ink", "#22303A"], c02: ["Charcoal", "#454C53"], c03: ["White", "#F3F0E9"], c04: ["Cream", "#E8DCC4"],
    c05: ["Coral", "#EF6F56"], c06: ["Red", "#C6433B"], c07: ["Gold", "#F4C856"], c08: ["Mustard", "#D39A2E"],
    c09: ["Sage", "#90A68B"], c10: ["Forest", "#3F6B4F"], c11: ["Teal", "#2F8F88"], c12: ["Sky", "#82B4DA"],
    c13: ["Navy", "#2E4A7D"], c14: ["Lilac", "#A891CF"], c15: ["Plum", "#6E3E6E"], c16: ["Denim", "#4F6E96"],
  };
  const lipColors = { none: ["Natural", null], l01: ["Nude", "#B8736A"], l02: ["Rose", "#C55A6B"], l03: ["Berry", "#8D2F4C"], l04: ["Coral", "#DE6E58"], l05: ["Plum", "#6B2D45"] };
  const frameColors = { f01: ["Black", "#1E1E22"], f02: ["Tortoise", "#7A4A28"], f03: ["Gold", "#C9A048"], f04: ["Clear blue", "#6F9CC8"], f05: ["Red", "#C6433B"] };

  // [label, extra metadata]
  const faceShapes = { oval: "Oval", round: "Round", square: "Square", heart: "Heart", long: "Long", diamond: "Diamond" };
  const builds = { slim: "Slim", regular: "Regular", broad: "Broad", soft: "Soft" };
  // volume: flat | medium | big. big hair cannot sit under fitted hats.
  const hairstyles = {
    bald: { label: "Bald", volume: "flat" },
    buzz: { label: "Buzz cut", volume: "flat" },
    fade: { label: "Fade", volume: "flat" },
    crop: { label: "Textured crop", volume: "medium" },
    sidepart: { label: "Side part", volume: "medium" },
    quiff: { label: "Quiff", volume: "medium" },
    curltop: { label: "Curly top fade", volume: "medium" },
    cornrows: { label: "Cornrows", volume: "flat" },
    afro: { label: "Afro", volume: "big" },
    puff: { label: "High puff", volume: "big" },
    twopuffs: { label: "Two puffs", volume: "big" },
    curlybob: { label: "Curly bob", volume: "big" },
    curlylong: { label: "Long curls", volume: "big" },
    locs: { label: "Locs", volume: "medium" },
    braids: { label: "Box braids", volume: "medium" },
    wavybob: { label: "Wavy bob", volume: "medium" },
    wavylong: { label: "Long waves", volume: "medium" },
    straightlong: { label: "Long straight", volume: "medium" },
    ponytail: { label: "Ponytail", volume: "medium" },
    bun: { label: "Top bun", volume: "big" },
    pixie: { label: "Pixie", volume: "medium" },
    shag: { label: "Shoulder shag", volume: "medium" },
  };
  const eyeShapes = { almond: "Almond", round: "Round", hooded: "Hooded", monolid: "Monolid", upturned: "Upturned", downturned: "Downturned", wide: "Wide", joyful: "Joyful" };
  const brows = { soft: "Soft", straight: "Straight", arched: "Arched", thick: "Thick", thin: "Thin", angled: "Angled", rounded: "Rounded", bushy: "Bushy" };
  const noses = { button: "Button", rounded: "Rounded", straight: "Straight", wide: "Wide", aquiline: "Aquiline", petite: "Petite" };
  const mouths = { smile: "Smile", grin: "Grin", laugh: "Laugh", smirk: "Smirk", calm: "Calm", soft: "Soft smile", wow: "Wow", focused: "Focused", cheeky: "Cheeky", beam: "Beam" };
  const facialHair = { none: "None", stubble: "Stubble", mustache: "Mustache", goatee: "Goatee", chinstrap: "Chin strap", short: "Short beard", full: "Full beard", long: "Long beard", soulpatch: "Soul patch", vandyke: "Mustache & goatee" };
  const blush = { none: "None", soft: "Soft", rosy: "Rosy" };
  const liner = { none: "None", soft: "Soft liner", wing: "Winged liner", shadow: "Eye shadow" };
  // Optional facial details, any combination of up to three.
  const details = { freckles: "Freckles", beautymark: "Beauty mark", vitiligo: "Vitiligo", dimples: "Dimples", rosy: "Rosy nose", lashes: "Long lashes" };

  // Wearable items. slot: which config key holds it. colorable: uses the
  // matching *Color key; fixed-colour special editions ignore it.
  // collection: essentials (free) | scholar | elite | podium | champion | seasonal.
  // rarity: common | rare | epic | legendary.
  // Extra rules: hidesHair / hidesEars (head coverings), fit: "fitted" hats
  // cannot sit over big hair, "crown" items sit on top of any hair.
  // covers: other slots this item replaces visually (a full-length dress).
  const E = "essentials";
  const items = {
    // --- head coverings & hats (all ordinary coverings are free) ---
    "headwear.none": { slot: "headwear", label: "None", collection: E, rarity: "common" },
    "headwear.wrap": { slot: "headwear", label: "Wrapped headscarf", collection: E, rarity: "common", colorable: true, hidesHair: true, hidesEars: true },
    "headwear.sport": { slot: "headwear", label: "Sport headscarf", collection: E, rarity: "common", colorable: true, hidesHair: true, hidesEars: true },
    "headwear.draped": { slot: "headwear", label: "Draped shawl", collection: E, rarity: "common", colorable: true, hidesHair: true, hidesEars: true },
    "headwear.khimar": { slot: "headwear", label: "Full-coverage wrap", collection: E, rarity: "common", colorable: true, hidesHair: true, hidesEars: true },
    "headwear.turban": { slot: "headwear", label: "Head wrap", collection: E, rarity: "common", colorable: true, hidesHair: true },
    "headwear.kufi": { slot: "headwear", label: "Kufi cap", collection: E, rarity: "common", colorable: true, fit: "crown" },
    "headwear.beanie": { slot: "headwear", label: "Beanie", collection: E, rarity: "common", colorable: true, fit: "fitted" },
    "headwear.cap": { slot: "headwear", label: "Cap", collection: E, rarity: "common", colorable: true, fit: "fitted" },
    "headwear.bucket": { slot: "headwear", label: "Bucket hat", collection: E, rarity: "common", colorable: true, fit: "fitted" },
    "headwear.mortarboard": { slot: "headwear", label: "Scholar's cap", collection: "scholar", rarity: "rare", fit: "fitted" },
    "headwear.laurel": { slot: "headwear", label: "Champion's laurel", collection: "champion", rarity: "legendary", fit: "crown" },
    "headwear.eliteband": { slot: "headwear", label: "Elite headband", collection: "elite", rarity: "rare", fit: "crown" },
    "headwear.podiumcap": { slot: "headwear", label: "Podium silver cap", collection: "podium", rarity: "epic", fit: "fitted" },
    "headwear.circuitcap": { slot: "headwear", label: "Circuit cap", collection: "seasonal", rarity: "epic", fit: "fitted" },
    // --- eyewear, hearing, mobility (assistive: always free) ---
    "glasses.none": { slot: "glasses", label: "None", collection: E, rarity: "common" },
    "glasses.round": { slot: "glasses", label: "Round", collection: E, rarity: "common", colorable: true },
    "glasses.square": { slot: "glasses", label: "Square", collection: E, rarity: "common", colorable: true },
    "glasses.cateye": { slot: "glasses", label: "Cat-eye", collection: E, rarity: "common", colorable: true },
    "glasses.wide": { slot: "glasses", label: "Oversized", collection: E, rarity: "common", colorable: true },
    "glasses.half": { slot: "glasses", label: "Half-rim", collection: E, rarity: "common", colorable: true },
    "glasses.shades": { slot: "glasses", label: "Sunglasses", collection: E, rarity: "common", colorable: true },
    "hearing.none": { slot: "hearing", label: "None", collection: E, rarity: "common" },
    "hearing.bte": { slot: "hearing", label: "Hearing aids", collection: E, rarity: "common" },
    "hearing.btecolor": { slot: "hearing", label: "Hearing aids, teal", collection: E, rarity: "common" },
    "hearing.cochlear": { slot: "hearing", label: "Cochlear processor", collection: E, rarity: "common" },
    "mobility.none": { slot: "mobility", label: "None", collection: E, rarity: "common" },
    "mobility.cane": { slot: "mobility", label: "Cane", collection: E, rarity: "common" },
    "mobility.crutches": { slot: "mobility", label: "Forearm crutches", collection: E, rarity: "common" },
    "mobility.wheelchair": { slot: "mobility", label: "Wheelchair", collection: E, rarity: "common" },
    "earrings.none": { slot: "earrings", label: "None", collection: E, rarity: "common" },
    "earrings.studs": { slot: "earrings", label: "Studs", collection: E, rarity: "common" },
    "earrings.hoops": { slot: "earrings", label: "Hoops", collection: E, rarity: "common" },
    // --- tops (all essentials are gender-neutral; tunic and dress are modest full coverage) ---
    "top.tee": { slot: "top", label: "T-shirt", collection: E, rarity: "common", colorable: true },
    "top.hoodie": { slot: "top", label: "Hoodie", collection: E, rarity: "common", colorable: true },
    "top.sweater": { slot: "top", label: "Crew sweater", collection: E, rarity: "common", colorable: true },
    "top.shirt": { slot: "top", label: "Button shirt", collection: E, rarity: "common", colorable: true },
    "top.overshirt": { slot: "top", label: "Open overshirt", collection: E, rarity: "common", colorable: true },
    "top.cardigan": { slot: "top", label: "Long cardigan", collection: E, rarity: "common", colorable: true },
    "top.blazer": { slot: "top", label: "Blazer", collection: E, rarity: "common", colorable: true },
    "top.polo": { slot: "top", label: "Polo", collection: E, rarity: "common", colorable: true },
    "top.tunic": { slot: "top", label: "Long tunic", collection: E, rarity: "common", colorable: true },
    "top.dress": { slot: "top", label: "Full-length dress", collection: E, rarity: "common", colorable: true, covers: ["bottom"] },
    "top.abaya": { slot: "top", label: "Open abaya", collection: E, rarity: "common", colorable: true, covers: ["bottom"] },
    "top.thobe": { slot: "top", label: "Thobe", collection: E, rarity: "common", colorable: true, covers: ["bottom"] },
    "top.vest": { slot: "top", label: "Sweater vest", collection: E, rarity: "common", colorable: true },
    "top.track": { slot: "top", label: "Track jacket", collection: E, rarity: "common", colorable: true },
    "top.varsity": { slot: "top", label: "Elite varsity jacket", collection: "elite", rarity: "rare" },
    "top.podiumjacket": { slot: "top", label: "Podium track jacket", collection: "podium", rarity: "epic" },
    "top.circuithoodie": { slot: "top", label: "Circuit hoodie", collection: "seasonal", rarity: "epic" },
    // --- bottoms ---
    "bottom.jeans": { slot: "bottom", label: "Jeans", collection: E, rarity: "common", colorable: true },
    "bottom.chinos": { slot: "bottom", label: "Chinos", collection: E, rarity: "common", colorable: true },
    "bottom.joggers": { slot: "bottom", label: "Joggers", collection: E, rarity: "common", colorable: true },
    "bottom.wide": { slot: "bottom", label: "Wide-leg trousers", collection: E, rarity: "common", colorable: true },
    "bottom.cargo": { slot: "bottom", label: "Cargo trousers", collection: E, rarity: "common", colorable: true },
    "bottom.midi": { slot: "bottom", label: "Midi skirt", collection: E, rarity: "common", colorable: true },
    "bottom.maxi": { slot: "bottom", label: "Maxi skirt", collection: E, rarity: "common", colorable: true },
    "bottom.pleated": { slot: "bottom", label: "Pleated trousers", collection: E, rarity: "common", colorable: true },
    "bottom.leggings": { slot: "bottom", label: "Leggings", collection: E, rarity: "common", colorable: true },
    "bottom.shorts": { slot: "bottom", label: "Knee shorts", collection: E, rarity: "common", colorable: true },
    // --- shoes ---
    "shoes.sneakers": { slot: "shoes", label: "Sneakers", collection: E, rarity: "common", colorable: true },
    "shoes.hightops": { slot: "shoes", label: "High-tops", collection: E, rarity: "common", colorable: true },
    "shoes.boots": { slot: "shoes", label: "Boots", collection: E, rarity: "common", colorable: true },
    "shoes.loafers": { slot: "shoes", label: "Loafers", collection: E, rarity: "common", colorable: true },
    "shoes.flats": { slot: "shoes", label: "Flats", collection: E, rarity: "common", colorable: true },
    "shoes.slipons": { slot: "shoes", label: "Slip-ons", collection: E, rarity: "common", colorable: true },
    "shoes.sandals": { slot: "shoes", label: "Sandals", collection: E, rarity: "common", colorable: true },
    "shoes.elite": { slot: "shoes", label: "Elite court sneakers", collection: "elite", rarity: "rare" },
    "shoes.gold": { slot: "shoes", label: "Champion gold kicks", collection: "champion", rarity: "legendary" },
    // --- neck & back ---
    "neck.none": { slot: "neck", label: "None", collection: E, rarity: "common" },
    "neck.headphones": { slot: "neck", label: "Headphones", collection: E, rarity: "common", colorable: true },
    "neck.scarf": { slot: "neck", label: "Winter scarf", collection: E, rarity: "common", colorable: true },
    "neck.tie": { slot: "neck", label: "Tie", collection: E, rarity: "common", colorable: true },
    "neck.lanyard": { slot: "neck", label: "Campus lanyard", collection: E, rarity: "common", colorable: true },
    "neck.scholarscarf": { slot: "neck", label: "Scholar stripe scarf", collection: "scholar", rarity: "rare" },
    "neck.medal": { slot: "neck", label: "Podium medal", collection: "podium", rarity: "epic" },
    "neck.elitepin": { slot: "neck", label: "Elite pin", collection: "elite", rarity: "rare" },
    "back.none": { slot: "back", label: "None", collection: E, rarity: "common" },
    "back.backpack": { slot: "back", label: "Backpack", collection: E, rarity: "common", colorable: true },
    "back.tote": { slot: "back", label: "Tote bag", collection: E, rarity: "common", colorable: true },
    "back.messenger": { slot: "back", label: "Messenger bag", collection: E, rarity: "common", colorable: true },
    "back.cape": { slot: "back", label: "Champion cape", collection: "champion", rarity: "legendary" },
    "back.circuitpack": { slot: "back", label: "Circuit pack", collection: "seasonal", rarity: "epic" },
    // --- scene ---
    "backdrop.mint": { slot: "backdrop", label: "Mint", collection: E, rarity: "common" },
    "backdrop.coral": { slot: "backdrop", label: "Coral", collection: E, rarity: "common" },
    "backdrop.gold": { slot: "backdrop", label: "Sunshine", collection: E, rarity: "common" },
    "backdrop.paper": { slot: "backdrop", label: "Paper", collection: E, rarity: "common" },
    "backdrop.sky": { slot: "backdrop", label: "Sky", collection: E, rarity: "common" },
    "backdrop.lilac": { slot: "backdrop", label: "Lilac", collection: E, rarity: "common" },
    "backdrop.campus": { slot: "backdrop", label: "Campus quad", collection: E, rarity: "common" },
    "backdrop.night": { slot: "backdrop", label: "Night study", collection: E, rarity: "common" },
    "backdrop.library": { slot: "backdrop", label: "Scholar library", collection: "scholar", rarity: "rare" },
    "backdrop.spotlight": { slot: "backdrop", label: "Elite spotlight", collection: "elite", rarity: "rare" },
    "backdrop.podium": { slot: "backdrop", label: "Podium stage", collection: "podium", rarity: "epic" },
    "backdrop.hall": { slot: "backdrop", label: "Champion hall", collection: "champion", rarity: "legendary" },
    "backdrop.circuit": { slot: "backdrop", label: "Circuit grid", collection: "seasonal", rarity: "epic" },
    "sticker.none": { slot: "sticker", label: "None", collection: E, rarity: "common" },
    "sticker.spark": { slot: "sticker", label: "Spark", collection: E, rarity: "common" },
    "sticker.bolt": { slot: "sticker", label: "Bolt", collection: E, rarity: "common" },
    "sticker.heart": { slot: "sticker", label: "Heart", collection: E, rarity: "common" },
    "sticker.star": { slot: "sticker", label: "Star", collection: E, rarity: "common" },
    "sticker.book": { slot: "sticker", label: "Book", collection: E, rarity: "common" },
    "sticker.code": { slot: "sticker", label: "Code", collection: E, rarity: "common" },
    "sticker.elite": { slot: "sticker", label: "Top 10 badge", collection: "elite", rarity: "rare" },
    "sticker.podium": { slot: "sticker", label: "Podium badge", collection: "podium", rarity: "epic" },
    "sticker.trophy": { slot: "sticker", label: "Champion trophy", collection: "champion", rarity: "legendary" },
    "sticker.circuit": { slot: "sticker", label: "Circuit chip", collection: "seasonal", rarity: "epic" },
  };

  const collections = {
    // unlock: a short, colour-independent tag shown on locked items.
    essentials: { label: "Campus Essentials", rule: "Free for every student.", unlock: "FREE", order: 1 },
    elite: { label: "Elite Collection", rule: "Finish in a verified Top 10.", unlock: "TOP 10", order: 2 },
    podium: { label: "Podium Collection", rule: "Finish in a verified Top 3.", unlock: "TOP 3", order: 3 },
    champion: { label: "Champion Collection", rule: "Finish first on a verified leaderboard.", unlock: "1ST PLACE", order: 4 },
    scholar: { label: "Scholar Collection", rule: "Academic threshold reward. Not active until the policy is approved.", unlock: "COMING LATER", order: 5, inactive: true },
    seasonal: { label: "Seasonal Collection", rule: "Arena Pass reward. Not active until XP rules are approved.", unlock: "ARENA PASS", order: 6, inactive: true },
  };
  const rarities = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };

  // Rank-based achievement rules (server-authoritative in B2; tested with fictional data).
  const rankRewards = [
    { maxPosition: 10, collections: ["elite"] },
    { maxPosition: 3, collections: ["elite", "podium"] },
    { maxPosition: 1, collections: ["elite", "podium", "champion"] },
  ];

  // Every config key, its kind and allowed values. Order is the canonical order.
  const fields = {
    skin: { kind: "enum", values: skin.map((_, index) => "s" + String(index + 1).padStart(2, "0")) },
    face: { kind: "enum", values: Object.keys(faceShapes) },
    build: { kind: "enum", values: Object.keys(builds) },
    hair: { kind: "enum", values: Object.keys(hairstyles) },
    hairColor: { kind: "enum", values: Object.keys(hairColors) },
    eyes: { kind: "enum", values: Object.keys(eyeShapes) },
    eyeColor: { kind: "enum", values: Object.keys(eyeColors) },
    brows: { kind: "enum", values: Object.keys(brows) },
    nose: { kind: "enum", values: Object.keys(noses) },
    mouth: { kind: "enum", values: Object.keys(mouths) },
    facialHair: { kind: "enum", values: Object.keys(facialHair) },
    blush: { kind: "enum", values: Object.keys(blush) },
    liner: { kind: "enum", values: Object.keys(liner) },
    lips: { kind: "enum", values: Object.keys(lipColors) },
    details: { kind: "set", values: Object.keys(details), max: 3 },
    headwear: { kind: "item", slot: "headwear" },
    headwearColor: { kind: "enum", values: Object.keys(clothColors) },
    glasses: { kind: "item", slot: "glasses" },
    glassesColor: { kind: "enum", values: Object.keys(frameColors) },
    hearing: { kind: "item", slot: "hearing" },
    mobility: { kind: "item", slot: "mobility" },
    earrings: { kind: "item", slot: "earrings" },
    top: { kind: "item", slot: "top" },
    topColor: { kind: "enum", values: Object.keys(clothColors) },
    bottom: { kind: "item", slot: "bottom" },
    bottomColor: { kind: "enum", values: Object.keys(clothColors) },
    shoes: { kind: "item", slot: "shoes" },
    shoesColor: { kind: "enum", values: Object.keys(clothColors) },
    neck: { kind: "item", slot: "neck" },
    neckColor: { kind: "enum", values: Object.keys(clothColors) },
    back: { kind: "item", slot: "back" },
    backColor: { kind: "enum", values: Object.keys(clothColors) },
    backdrop: { kind: "item", slot: "backdrop" },
    sticker: { kind: "item", slot: "sticker" },
  };
  for (const field of Object.values(fields)) {
    if (field.kind === "item") field.values = Object.keys(items).filter((key) => items[key].slot === field.slot).map((key) => key.split(".")[1]);
  }

  // The neutral starting look: not derived from anyone's data.
  const DEFAULT_CONFIG = Object.freeze({
    v: SCHEMA_VERSION,
    skin: "s05", face: "oval", build: "regular", hair: "crop", hairColor: "h03",
    eyes: "almond", eyeColor: "e02", brows: "soft", nose: "button", mouth: "smile",
    facialHair: "none", blush: "none", liner: "none", lips: "none", details: Object.freeze([]),
    headwear: "none", headwearColor: "c11", glasses: "none", glassesColor: "f01",
    hearing: "none", mobility: "none", earrings: "none",
    top: "hoodie", topColor: "c11", bottom: "jeans", bottomColor: "c16", shoes: "sneakers", shoesColor: "c03",
    neck: "none", neckColor: "c05", back: "none", backColor: "c05",
    backdrop: "mint", sticker: "spark",
  });

  const MAX_CONFIG_BYTES = 1024;
  const itemKey = (field, value) => `${fields[field].slot}.${value}`;

  // Pure compatibility rules shared by the studio, randomizer and server.
  function compatibilityErrors(config) {
    const errors = [];
    const headwear = items[itemKey("headwear", config.headwear)];
    const hair = hairstyles[config.hair];
    if (headwear?.fit === "fitted" && hair?.volume === "big") errors.push({ field: "headwear", code: "hair_too_big_for_hat" });
    return errors;
  }

  // Validates shape, types and catalog membership. ownedItems: a Set of item
  // keys ("top.varsity") the student owns; essentials are always owned.
  // Returns { ok, errors, config } where config is the canonical copy.
  function validateConfig(input, { ownedItems = new Set() } = {}) {
    const errors = [];
    if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: [{ field: "*", code: "not_object" }] };
    let size = 0;
    try { size = new TextEncoder().encode(JSON.stringify(input)).length; } catch { return { ok: false, errors: [{ field: "*", code: "unserializable" }] }; }
    if (size > MAX_CONFIG_BYTES) return { ok: false, errors: [{ field: "*", code: "too_large" }] };
    if (input.v !== SCHEMA_VERSION) errors.push({ field: "v", code: "bad_version" });
    for (const key of Object.keys(input)) if (key !== "v" && !Object.hasOwn(fields, key)) errors.push({ field: key, code: "unknown_field" });
    const config = { v: SCHEMA_VERSION };
    for (const [key, field] of Object.entries(fields)) {
      const value = input[key];
      if (!Object.hasOwn(input, key)) { errors.push({ field: key, code: "missing" }); continue; }
      if (field.kind === "set") {
        if (!Array.isArray(value) || value.length > field.max || new Set(value).size !== value.length ||
          !value.every((entry) => typeof entry === "string" && field.values.includes(entry))) {
          errors.push({ field: key, code: "invalid" });
          continue;
        }
        config[key] = field.values.filter((entry) => value.includes(entry)); // canonical order
        continue;
      }
      if (typeof value !== "string" || !field.values.includes(value)) { errors.push({ field: key, code: "invalid" }); continue; }
      config[key] = value;
      if (field.kind === "item") {
        const keyName = itemKey(key, value);
        if (items[keyName].collection !== E && !ownedItems.has(keyName)) errors.push({ field: key, code: "not_owned", item: keyName });
      }
    }
    if (!errors.length) errors.push(...compatibilityErrors(config));
    return errors.length ? { ok: false, errors } : { ok: true, errors: [], config };
  }

  // A best-effort copy for drawing anything (old, partial or foreign data):
  // every unknown or invalid value becomes the default. Never used to save.
  function normalizeForRender(input) {
    const config = { ...DEFAULT_CONFIG, details: [] };
    if (!input || typeof input !== "object") return config;
    for (const [key, field] of Object.entries(fields)) {
      const value = input[key];
      if (field.kind === "set") {
        if (Array.isArray(value)) config.details = field.values.filter((entry) => value.includes(entry)).slice(0, field.max);
      } else if (typeof value === "string" && field.values.includes(value)) config[key] = value;
    }
    if (compatibilityErrors(config).length) config.headwear = "none";
    return config;
  }

  function collectionsForPosition(position) {
    const earned = new Set();
    if (!Number.isInteger(position) || position < 1) return [];
    for (const rule of rankRewards) if (position <= rule.maxPosition) rule.collections.forEach((name) => earned.add(name));
    return [...earned];
  }

  const itemsInCollection = (name) => Object.keys(items).filter((key) => items[key].collection === name && !key.endsWith(".none"));

  // Provenance of every drawing in this catalogue (see docs/design/character-v2.md).
  const PROVENANCE = Object.freeze({
    origin: "Original vector artwork drawn in code for Academic Arena (assets/avatar-v2/render.js).",
    thirdPartyAssets: false,
    generatedByAI: false,
    runtimeNetwork: false,
    fonts: "System fonts only (Impact / Arial Black fallback) for badge numerals.",
  });

  root.AcademicArenaAvatarCatalog = Object.freeze({
    SCHEMA_VERSION, MAX_CONFIG_BYTES, DEFAULT_CONFIG, PROVENANCE,
    palettes: { skin, hairColors, eyeColors, clothColors, lipColors, frameColors },
    options: { faceShapes, builds, hairstyles, eyeShapes, brows, noses, mouths, facialHair, blush, liner, details },
    items, collections, rarities, rankRewards, fields,
    validateConfig, normalizeForRender, compatibilityErrors, collectionsForPosition, itemsInCollection, itemKey,
  });
})(typeof window !== "undefined" ? window : globalThis);
