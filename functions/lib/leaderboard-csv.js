// Strict, bounded parser for staff ranking uploads. The file may contain only
// what the public board displays; no grades, scores, IDs, or emails.

export const RANKING_COLUMNS = Object.freeze([
  "level", "semester", "cohort_key", "cohort_label", "board_kind",
  "module_key", "module_label", "rank", "public_name", "avatar_key", "avatar_family",
]);
export const MAX_CSV_BYTES = 256 * 1024;
export const MAX_DATA_ROWS = 2000;
const MAX_FIELD_LENGTH = 120;
const MAX_ERRORS = 25;

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,47}$/u;
const NAME_PATTERN = /^\p{L}[\p{L}\p{M} .'’-]{0,59}$/u;
const LABEL_PATTERN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'’()&/:+-]{0,79}$/u;
const YEAR_PATTERN = /^20\d{2}-\d{2}$/u;
const AVATARS = new Set(["omar", "mariam", "youssef", "amara", "tariq", "habiba2", "malek", "nour2", "zein"]);
const FAMILIES = new Set(["ink", "cartoon3d"]);
// Characters that never belong in an upload (controls, markup, formula prefixes handled per field).
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>"`\\{}[\]|;=]/u;

export function boardKey(row) {
  return [row.level, row.semester, row.cohort_key, row.board_kind, row.module_key ?? ""].join("|");
}

function clean(value) {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function splitFields(line) {
  return line.split(",").map((raw) => {
    if (raw.length >= 2 && raw.startsWith("\"") && raw.endsWith("\"") && !raw.slice(1, -1).includes("\"")) {
      return { value: raw.slice(1, -1) };
    }
    if (raw.includes("\"")) return { error: "quotes are not allowed inside values" };
    return { value: raw };
  });
}

export function validAcademicYear(value) {
  if (typeof value !== "string" || !YEAR_PATTERN.test(value)) return false;
  const start = Number(value.slice(2, 4));
  const end = Number(value.slice(5, 7));
  return end === (start + 1) % 100;
}

export function parseRankingCsv(text) {
  const errors = [];
  const fail = (line, message) => {
    if (errors.length < MAX_ERRORS) errors.push({ line, message });
  };
  if (typeof text !== "string" || text.length === 0) return { ok: false, errors: [{ line: 0, message: "The file is empty." }] };
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) {
    return { ok: false, errors: [{ line: 0, message: "The file is larger than 256 KB." }] };
  }

  const lines = text.replace(/^﻿/u, "").split(/\r?\n/u);
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length < 2) return { ok: false, errors: [{ line: 0, message: "The file has no ranking rows." }] };
  if (lines.length - 1 > MAX_DATA_ROWS) {
    return { ok: false, errors: [{ line: 0, message: `The file has more than ${MAX_DATA_ROWS} rows.` }] };
  }

  const header = lines[0].split(",").map((name) => name.trim().toLowerCase());
  if (header.length !== RANKING_COLUMNS.length || header.some((name, index) => name !== RANKING_COLUMNS[index])) {
    return {
      ok: false,
      errors: [{ line: 1, message: `The header must be exactly: ${RANKING_COLUMNS.join(",")}` }],
    };
  }

  const rows = [];
  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    if (line.trim() === "") {
      fail(lineNumber, "Blank lines are not allowed between rows.");
      continue;
    }
    const fields = splitFields(line);
    if (fields.length !== RANKING_COLUMNS.length) {
      fail(lineNumber, `Expected ${RANKING_COLUMNS.length} values, found ${fields.length}.`);
      continue;
    }
    const record = {};
    let rowValid = true;
    fields.forEach((field, column) => {
      const name = RANKING_COLUMNS[column];
      if (field.error) {
        fail(lineNumber, `${name}: ${field.error}.`);
        rowValid = false;
        return;
      }
      if (field.value.length > MAX_FIELD_LENGTH || FORBIDDEN.test(field.value)) {
        fail(lineNumber, `${name}: contains characters or length that are not allowed.`);
        rowValid = false;
        return;
      }
      record[name] = clean(field.value);
    });
    if (!rowValid) continue;

    const row = {};
    const level = record.level;
    if (!["4", "5", "6"].includes(level)) { fail(lineNumber, "level must be 4, 5, or 6."); rowValid = false; }
    if (!["1", "2"].includes(record.semester)) { fail(lineNumber, "semester must be 1 or 2."); rowValid = false; }
    if (!KEY_PATTERN.test(record.cohort_key)) { fail(lineNumber, "cohort_key must be a lowercase identifier."); rowValid = false; }
    if (!LABEL_PATTERN.test(record.cohort_label)) { fail(lineNumber, "cohort_label contains characters that are not allowed."); rowValid = false; }
    if (!["semester", "module"].includes(record.board_kind)) { fail(lineNumber, "board_kind must be semester or module."); rowValid = false; }
    if (record.board_kind === "module") {
      if (!KEY_PATTERN.test(record.module_key)) { fail(lineNumber, "module_key is required for module boards."); rowValid = false; }
      if (!LABEL_PATTERN.test(record.module_label)) { fail(lineNumber, "module_label is required for module boards."); rowValid = false; }
    } else if (record.module_key !== "" || record.module_label !== "") {
      fail(lineNumber, "Semester boards must leave module_key and module_label empty.");
      rowValid = false;
    }
    if (!/^(10|[1-9])$/u.test(record.rank)) { fail(lineNumber, "rank must be a whole number from 1 to 10."); rowValid = false; }
    if (!NAME_PATTERN.test(record.public_name)) {
      fail(lineNumber, "public_name must be a name of letters, spaces, apostrophes, hyphens, or periods.");
      rowValid = false;
    }
    if (!AVATARS.has(record.avatar_key)) { fail(lineNumber, "avatar_key is not an approved character."); rowValid = false; }
    if (!FAMILIES.has(record.avatar_family)) { fail(lineNumber, "avatar_family must be ink or cartoon3d."); rowValid = false; }
    if (!rowValid) continue;

    row.level = Number(level);
    row.semester = Number(record.semester);
    row.cohort_key = record.cohort_key;
    row.cohort_label = record.cohort_label;
    row.board_kind = record.board_kind;
    row.module_key = record.board_kind === "module" ? record.module_key : null;
    row.module_label = record.board_kind === "module" ? record.module_label : null;
    row.position = Number(record.rank);
    row.public_name = record.public_name;
    row.avatar_key = record.avatar_key;
    row.avatar_family = record.avatar_family;
    row.line = lineNumber;
    rows.push(row);
  }
  if (errors.length) return { ok: false, errors };

  const boards = new Map();
  const cohortLabels = new Map();
  const moduleLabels = new Map();
  for (const row of rows) {
    const key = boardKey(row);
    if (!boards.has(key)) boards.set(key, { positions: new Set(), names: new Set(), count: 0 });
    const board = boards.get(key);
    if (board.positions.has(row.position)) fail(row.line, `Duplicate rank ${row.position} on this board.`);
    const normalizedName = row.public_name.toLocaleLowerCase("en");
    if (board.names.has(normalizedName)) fail(row.line, "This student already appears on this board.");
    board.positions.add(row.position);
    board.names.add(normalizedName);
    board.count += 1;

    const cohortKey = `${row.level}|${row.semester}|${row.cohort_key}`;
    if (cohortLabels.has(cohortKey) && cohortLabels.get(cohortKey) !== row.cohort_label) {
      fail(row.line, "cohort_label differs from an earlier row for the same cohort.");
    }
    cohortLabels.set(cohortKey, row.cohort_label);
    if (row.board_kind === "module") {
      const moduleKey = `${cohortKey}|${row.module_key}`;
      if (moduleLabels.has(moduleKey) && moduleLabels.get(moduleKey) !== row.module_label) {
        fail(row.line, "module_label differs from an earlier row for the same module.");
      }
      moduleLabels.set(moduleKey, row.module_label);
    }
  }
  for (const [key, board] of boards) {
    for (let position = 1; position <= board.count; position += 1) {
      if (!board.positions.has(position)) {
        fail(0, `Board ${key.replaceAll("|", " / ")} must use ranks 1 to ${board.count} with no gaps.`);
        break;
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, rows: rows.map(({ line, ...row }) => row), boardCount: boards.size };
}

function describeBoard(row) {
  const scope = row.board_kind === "module" ? `module ${row.module_key}` : "semester board";
  return `Level ${row.level} · Semester ${row.semester} · ${row.cohort_key} · ${scope}`;
}

// Summarise what publishing would change compared with the live rows.
export function diffBoards(liveRows, nextRows) {
  const group = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const key = boardKey(row);
      if (!map.has(key)) map.set(key, { label: describeBoard(row), entries: new Map() });
      map.get(key).entries.set(row.position, `${row.public_name}|${row.avatar_key}|${row.avatar_family}`);
    }
    return map;
  };
  const live = group(liveRows);
  const next = group(nextRows);
  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;
  for (const [key, board] of next) {
    const before = live.get(key);
    if (!before) {
      added.push({ board: board.label, rows: board.entries.size });
      continue;
    }
    let differences = 0;
    const positions = new Set([...board.entries.keys(), ...before.entries.keys()]);
    for (const position of positions) {
      if (board.entries.get(position) !== before.entries.get(position)) differences += 1;
    }
    if (differences) changed.push({ board: board.label, changedPositions: differences });
    else unchanged += 1;
  }
  for (const [key, board] of live) {
    if (!next.has(key)) removed.push({ board: board.label, rows: board.entries.size });
  }
  return { added, changed, removed, unchanged };
}
