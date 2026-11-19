// Staff-review helper: proposes a default board character from a first name.
// A suggestion is only a starting point for staff, who confirm or change every
// row before anything is saved. Nothing here is a verified attribute: the
// result is never sent to the server or stored, and only the character staff
// approve is saved. Unisex or unrecognised names get no suggestion and are
// flagged. Characters implying religious dress (habiba2) or disability (zein)
// are never suggested automatically; staff may still choose them by hand.
// The lexicon is a generic list of common first names, not student data.
(function attachCharacterSuggestions(root) {
  "use strict";

  const MASCULINE_PRESENTING = ["youssef", "omar", "tariq", "malek"];
  const FEMININE_PRESENTING = ["mariam", "amara", "nour2"];

  const words = (text) => new Set(text.trim().split(/\s+/u));
  const MASCULINE = words(`
    abdallah abdalla abdelrahman abdelrahim abdelaziz abdelhamid abdelmeguid abdo abdulla abdullah abdulrahman adam adel adham ahmad ahmed
    akram ali aly amgad amir amr anas andrew anwar ashraf ayman bahaa basel bassel bassem belal bilal bishoy daniel david ehab emad
    eslam essam fady fadi fares farid fathy fawzy george ghaly hady hamed hamza hany haitham hassan hatem hazem hesham hossam hussein
    ibrahim islam ismail jack james john joseph kamal karim kareem khaled khalid kirollos mahmoud marco marcos mark marwan mazen michael
    mina mohamed mohammed mohammad momen mostafa moustafa muhammad muhanned mohannad mohanad nabil nader nasser omar osama paul patrick
    peter ramy ramez reda saad sameh samir sami seif seifeldin sherif shady sameer tamer tarek tariq waleed walid yahia yahya yassen
    yassin yasin yasser youssef yousef youssif yusuf zain zeyad ziad zyad noureldin nour-eldin
  `);
  const FEMININE = words(`
    aisha aya ayah basma dalia dina doaa engy esraa fatma fatima farah farida ganna gana habiba hagar hala hana hanaa heba hend
    jana jannah janna jasmine joudy judy laila layla lara lina lobna lojain lujain maha mai malak mariam maryam mariem marina menna
    mennatullah merna mirna mona nada nadia nadine nagwa nermeen noha nouran nourhan omnia rahma rana randa rania reem rodina rokaya
    ruqayya radiya razan rowan salma sama samar sandy sara sarah shahd shaimaa shorouk soha sohaila somaya yara yasmin yasmine yomna
    youmna zeina zeinab zainab
  `);
  // Common unisex names: always flagged for a staff decision.
  const UNISEX = words("alaa nour noor shams salam safaa wesam wissam jihad iman eman rida taha");

  function normalized(firstName) {
    return String(firstName ?? "").normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase().replace(/[^a-z-]/gu, "");
  }

  // Returns { character: key | null, flag: null | "ambiguous" | "unknown" }.
  function classify(fullName) {
    const first = normalized(String(fullName ?? "").trim().split(/\s+/u)[0]);
    if (!first) return { group: null, flag: "unknown" };
    if (UNISEX.has(first)) return { group: null, flag: "ambiguous" };
    if (MASCULINE.has(first)) return { group: "m", flag: null };
    if (FEMININE.has(first)) return { group: "f", flag: null };
    return { group: null, flag: "unknown" };
  }

  // rows: [{ level, position, name }] for one publication. Rotates through
  // each pool per level so neighbouring ranks rarely repeat a character.
  function suggestCharacters(rows) {
    const used = new Map();
    return rows.map((row) => {
      const { group, flag } = classify(row.name);
      if (!group) return { level: row.level, position: row.position, character: null, flag };
      const pool = group === "m" ? MASCULINE_PRESENTING : FEMININE_PRESENTING;
      const key = `${row.level}:${group}`;
      const count = used.get(key) || 0;
      used.set(key, count + 1);
      return { level: row.level, position: row.position, character: pool[count % pool.length], flag: null };
    });
  }

  root.AcademicArenaCharacterSuggestions = Object.freeze({ suggestCharacters });
})(globalThis);
