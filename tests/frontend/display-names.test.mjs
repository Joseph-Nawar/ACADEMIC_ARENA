import assert from "node:assert/strict";
import test from "node:test";
import "../../assets/display-names.js";

const { shortDisplayNames } = globalThis.AcademicArenaDisplayNames;

test("first and final components, whitespace normalized", () => {
  assert.deepEqual(shortDisplayNames(["  Fictional   Student  Middle   Lastname ", "Solo", "Two Words"]),
    ["Fictional Lastname", "Solo", "Two Words"]);
});

test("identical short names expand with middle components until unique", () => {
  assert.deepEqual(shortDisplayNames([
    "Sample Noureldin Khaled Elmahdy", "Sample Noureldin Fawzy Elmahdy", "Sample Kamal Elmahdy", "Other Person",
  ]), ["Sample Noureldin Khaled Elmahdy", "Sample Noureldin Fawzy Elmahdy", "Sample Kamal Elmahdy", "Other Person"]);
});

test("a short name colliding with another full two-part name expands only the longer one", () => {
  assert.deepEqual(shortDisplayNames(["Fictional Omar Ali", "Fictional Ali"]), ["Fictional Omar Ali", "Fictional Ali"]);
});

test("collisions are case-insensitive and Unicode-aware", () => {
  assert.deepEqual(shortDisplayNames(["ÉLODIE Marie Test", "élodie Anne test"]), ["ÉLODIE Marie Test", "élodie Anne test"]);
  assert.deepEqual(shortDisplayNames(["Zoë Q Ångström"]), ["Zoë Ångström"]);
});

test("names that cannot be distinguished by components fall back to the full approved text", () => {
  assert.deepEqual(shortDisplayNames(["Same  Name", "Same Name"]), ["Same  Name", "Same Name"]);
});

test("output order and length match input; empty input is safe", () => {
  assert.deepEqual(shortDisplayNames([]), []);
  const names = Array.from({ length: 10 }, (_, index) => `Fictional Person${index} Middle Surname${index}`);
  assert.deepEqual(shortDisplayNames(names), names.map((_, index) => `Fictional Surname${index}`));
});
