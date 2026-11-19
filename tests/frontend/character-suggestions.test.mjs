import assert from "node:assert/strict";
import test from "node:test";
import "../../assets/character-suggestions.js";

const { suggestCharacters } = globalThis.AcademicArenaCharacterSuggestions;
const rows = (names) => names.map((name, index) => ({ level: 4, position: index + 1, name }));

test("suggestions are only character keys from the human cast, with unisex and unknown names flagged", () => {
  const result = suggestCharacters(rows(["Omar Fictional", "Mariam Sample", "Alaa Example", "Zyxq Testname", "Nour Person"]));
  assert.equal(result[0].flag, null);
  assert.equal(result[1].flag, null);
  assert.deepEqual([result[2].character, result[2].flag], [null, "ambiguous"]);
  assert.deepEqual([result[3].character, result[3].flag], [null, "unknown"]);
  assert.deepEqual([result[4].character, result[4].flag], [null, "ambiguous"]);
  for (const item of result) assert.deepEqual(Object.keys(item).sort(), ["character", "flag", "level", "position"], "no gender label is returned");
});

test("religious dress and disability are never suggested automatically", () => {
  const many = Array.from({ length: 40 }, (_, index) => (index % 2 ? "Sara Fictional" : "Ahmed Fictional"));
  const characters = new Set(suggestCharacters(rows(many)).map((item) => item.character));
  assert.ok(!characters.has("habiba2"));
  assert.ok(!characters.has("zein"));
});

test("neighbouring ranks rotate characters within a level", () => {
  const result = suggestCharacters(rows(["Ahmed A", "Omar B", "Youssef C", "Karim D"]));
  assert.equal(new Set(result.map((item) => item.character)).size, 4);
});

test("names are matched case- and accent-insensitively on the first name only", () => {
  const [result] = suggestCharacters(rows(["  MARIAM   Example "]));
  assert.ok(result.character && result.flag === null);
  assert.equal(suggestCharacters(rows(["Example Mariam"]))[0].flag, "unknown", "only the first name is considered");
});
