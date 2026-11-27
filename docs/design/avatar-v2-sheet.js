// Contact sheet: deterministic combinations so reviewers see every asset on
// several skin tones, hair textures, faces and builds.
(() => {
  const C = window.AcademicArenaAvatarCatalog;
  const R = window.AcademicArenaAvatarRenderer;
  const sheet = document.getElementById("sheet");
  const skins = C.fields.skin.values;
  const base = { ...C.DEFAULT_CONFIG, details: [] };
  function section(title, configs, context = "full") {
    const h = document.createElement("h2"); h.textContent = title; sheet.append(h);
    const row = document.createElement("div"); row.className = "row"; sheet.append(row);
    configs.forEach(([label, config]) => {
      const fig = document.createElement("figure"); if (context === "portrait") fig.className = "portrait";
      fig.innerHTML = R.render({ ...base, ...config }, { context, decorative: true });
      const cap = document.createElement("figcaption"); cap.textContent = label; fig.append(cap); row.append(fig);
    });
  }
  const pick = (list, i) => list[i % list.length];
  const hairColors = C.fields.hairColor.values;
  section("Hairstyles × skin tones", C.fields.hair.values.map((hair, i) => [hair, { hair, skin: pick(skins, i * 5), hairColor: pick(["h01", "h03", "h05", "h09", "h02", "h07", "h04", "h12"], i), face: pick(C.fields.face.values, i), eyes: pick(C.fields.eyes.values, i), mouth: pick(C.fields.mouth.values, i), brows: pick(C.fields.brows.values, i), nose: pick(C.fields.nose.values, i), backdrop: "paper", sticker: "none" }]), "portrait");
  section("Skin tones", skins.map((skin, i) => [skin, { skin, hair: pick(["afro", "straightlong", "locs", "wavybob", "fade", "braids"], i), backdrop: "paper", sticker: "none" }]), "portrait");
  section("Head coverings", ["wrap", "sport", "draped", "khimar", "turban", "kufi", "beanie", "cap", "bucket"].map((headwear, i) => [headwear, { headwear, hair: headwear === "kufi" ? "fade" : "straightlong", skin: pick(skins, i * 4 + 2), headwearColor: pick(C.fields.headwearColor.values, i * 3 + 1), backdrop: "paper", sticker: "none" }]), "portrait");
  section("Faces, eyes, mouths", C.fields.eyes.values.map((eyes, i) => [`${eyes} / ${pick(C.fields.mouth.values, i)}`, { eyes, mouth: pick(C.fields.mouth.values, i + 2), face: pick(C.fields.face.values, i), skin: pick(skins, i * 3), eyeColor: pick(C.fields.eyeColor.values, i), hair: "bald", backdrop: "paper", sticker: "none" }]), "portrait");
  section("Facial hair", C.fields.facialHair.values.map((facialHair, i) => [facialHair, { facialHair, hair: pick(["crop", "fade", "sidepart", "locs", "curltop"], i), skin: pick(skins, i * 5 + 3), hairColor: pick(hairColors, i), backdrop: "paper", sticker: "none" }]), "portrait");
  section("Makeup, details, glasses, hearing", [
    ["liner wing + rose", { liner: "wing", lips: "l02", blush: "soft", hair: "wavylong" }],
    ["shadow + berry", { liner: "shadow", lips: "l03", hair: "bun", skin: "s11" }],
    ["freckles", { details: ["freckles"], hair: "shag", hairColor: "h07", skin: "s01" }],
    ["vitiligo", { details: ["vitiligo"], hair: "afro", skin: "s10" }],
    ["round glasses", { glasses: "round", hair: "curlybob", skin: "s08" }],
    ["cat-eye", { glasses: "cateye", glassesColor: "f05", hair: "ponytail" }],
    ["hearing aids", { hearing: "bte", hair: "buzz", skin: "s09" }],
    ["cochlear", { hearing: "cochlear", hair: "pixie", skin: "s03" }],
    ["earrings hoops", { earrings: "hoops", hair: "puff", skin: "s12" }],
  ].map(([l, c]) => [l, { backdrop: "paper", sticker: "none", ...c }]), "portrait");
  section("Builds and outfits", C.fields.build.values.flatMap((build, b) => C.fields.top.values.slice(0, 10).filter((_, i) => i % 4 === b % 4 || i % 4 === (b + 2) % 4).map((top, i) => [`${build} / ${top}`, { build, top, bottom: pick(C.fields.bottom.values.slice(0, 7), b + i), topColor: pick(C.fields.topColor.values, b * 3 + i * 5), bottomColor: pick(["c16", "c01", "c04", "c13", "c09"], i + b), skin: pick(skins, b * 3 + i), hair: pick(C.fields.hair.values, b * 7 + i * 3), shoes: pick(C.fields.shoes.values.slice(0, 5), i) }])));
  section("Mobility aids", [["wheelchair", { mobility: "wheelchair", hair: "locs", skin: "s10" }], ["wheelchair + dress", { mobility: "wheelchair", top: "dress", topColor: "c14", headwear: "wrap", headwearColor: "c13", skin: "s06" }], ["cane", { mobility: "cane", hair: "sidepart", hairColor: "h12", skin: "s02" }], ["crutches", { mobility: "crutches", hair: "braids", skin: "s09", bottom: "joggers" }]]);
  section("Reward collections", [
    ["Elite", { top: "varsity", shoes: "elite", neck: "elitepin", backdrop: "spotlight", sticker: "elite", hair: "curltop", skin: "s09" }],
    ["Podium", { top: "podiumjacket", neck: "medal", backdrop: "podium", sticker: "podium", hair: "wavylong", skin: "s04" }],
    ["Champion", { headwear: "laurel", back: "cape", shoes: "gold", backdrop: "hall", sticker: "trophy", hair: "afro", skin: "s11" }],
    ["Champion + scarf", { headwear: "sport", headwearColor: "c13", back: "cape", shoes: "gold", backdrop: "hall", sticker: "trophy", skin: "s05" }],
    ["Scholar", { headwear: "mortarboard", neck: "scholarscarf", backdrop: "library", hair: "straightlong", skin: "s07", top: "blazer", topColor: "c13" }],
    ["Seasonal", { headwear: "circuitcap", top: "circuithoodie", back: "circuitpack", backdrop: "circuit", sticker: "circuit", hair: "locs", skin: "s06" }],
  ]);
  section("Backdrops", C.fields.backdrop.values.map((backdrop, i) => [backdrop, { backdrop, skin: pick(skins, i * 5) }]), "portrait");
})();
