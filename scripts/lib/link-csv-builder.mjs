// Pure helpers for building a private `level,rank,username` link file on the
// operator's device (no network, no logging). Rows are joined ONLY on a
// verified identifier shared by both files: the institutional email, or the
// university reference held in the roster's `roster_ref` column (e.g. the
// student number). Names are never a join key; at most they are an optional
// cross-check against the published board. Every problem is reported by
// position or line number only, never with the identifier, name or username.
import { USERNAME_PATTERN } from "./student-roster.mjs";

export const ROSTER_HEADER = Object.freeze(["roster_ref", "email", "username", "eligible"]);
export const KEYS = Object.freeze({ email: "email", "roster-ref": "roster_ref" });
const MAX_ROWS = 5000;

// Minimal RFC 4180 reader (spreadsheet "Save as CSV" output, quoted fields).
export function parseCsv(text) {
  if (typeof text !== "string") return { ok: false, error: "file is not text" };
  const source = text.replace(/^﻿/u, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === "\"" && source[index + 1] === "\"") { field += "\""; index += 1; }
      else if (char === "\"") quoted = false;
      else field += char;
    } else if (char === "\"" && field === "") quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
    if (rows.length > MAX_ROWS) return { ok: false, error: `more than ${MAX_ROWS} rows` };
  }
  if (quoted) return { ok: false, error: "unterminated quoted field" };
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((value) => value.trim() === "")) rows.pop();
  if (!rows.length) return { ok: false, error: "file is empty" };
  return { ok: true, header: rows[0].map((value) => value.trim().toLowerCase()), rows: rows.slice(1) };
}

export function normalizeKey(kind, value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return kind === "email" ? text.toLowerCase() : text.replace(/\s+/gu, "").toUpperCase();
}

// Spreadsheets rewrite long references (2.02301E+11, 20230112345.0), which can
// make two different students look identical. Such values never join.
export function keyProblem(kind, key) {
  if (kind === "email") {
    return /^[a-z0-9._%+-]{1,64}@([a-z0-9-]+\.)+[a-z]{2,}$/u.test(key) ? null : "is not a valid email address";
  }
  if (/^[0-9.,]+E\+?[0-9]+$/u.test(key) || /^[0-9]+[.,][0-9]+$/u.test(key)) {
    return "was rewritten as a number by a spreadsheet; export that column as text";
  }
  return /^[A-Z0-9_-]{3,40}$/u.test(key) ? null : "must be 3–40 letters, digits, _ or -";
}

// Names only for an optional sanity check: case, accents and spacing ignored.
export function normalizeName(value) {
  return String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
}

function column(header, name, label) {
  const index = header.indexOf(String(name).trim().toLowerCase());
  return index >= 0 ? { index } : { error: `${label}: column "${name}" not found in the header` };
}

/**
 * @param {object} input
 * @param {string} input.sourceText   official ranking source exported as CSV
 * @param {string} input.rosterText   private roster (roster_ref,email,username,eligible)
 * @param {"email"|"roster-ref"} input.key
 * @param {{level:string, rank:string, key:string, name?:string}} input.columns  source column names
 * @param {string} [input.publishedText]  the approved level,rank,public_name file (optional cross-check)
 * @param {string} [input.currentText]    current links downloaded from Staff Desk (optional; kept)
 * @param {boolean} [input.allowNameMismatch]
 * @returns {{ ok: boolean, fatal?: string[], links: {level:number, rank:number, username:string}[], problems: string[], summary: object }}
 */
export function buildLinks(input) {
  const fatal = [];
  const problems = [];
  const kind = input.key;
  if (!Object.hasOwn(KEYS, kind)) return { ok: false, fatal: ["--key must be email or roster-ref"], links: [], problems, summary: {} };
  const rosterColumn = KEYS[kind];

  // ---- roster
  const roster = parseCsv(input.rosterText);
  if (!roster.ok) return { ok: false, fatal: [`roster: ${roster.error}`], links: [], problems, summary: {} };
  if (roster.header.join(",") !== ROSTER_HEADER.join(",")) {
    return { ok: false, fatal: [`roster: header must be exactly ${ROSTER_HEADER.join(",")}`], links: [], problems, summary: {} };
  }
  const rosterByKey = new Map(); // key -> [{ username, eligible, line }]
  const usernameLines = new Map();
  roster.rows.forEach((fields, offset) => {
    const line = offset + 2;
    if (fields.length !== 4) { fatal.push(`roster line ${line}: expected 4 values`); return; }
    const [ref, email, rawUsername, eligible] = fields.map((value) => value.trim());
    const username = rawUsername.toLowerCase();
    const key = normalizeKey(kind, kind === "email" ? email : ref);
    if (!key) { fatal.push(`roster line ${line}: empty ${rosterColumn}`); return; }
    const invalid = keyProblem(kind, key);
    if (invalid) { fatal.push(`roster line ${line}: ${rosterColumn} ${invalid}`); return; }
    if (!USERNAME_PATTERN.test(username)) { fatal.push(`roster line ${line}: invalid username`); return; }
    if (!["yes", "no"].includes(eligible.toLowerCase())) { fatal.push(`roster line ${line}: eligible must be yes or no`); return; }
    if (usernameLines.has(username)) fatal.push(`roster line ${line}: username also on line ${usernameLines.get(username)}`);
    else usernameLines.set(username, line);
    const list = rosterByKey.get(key) || [];
    list.push({ username, eligible: eligible.toLowerCase() === "yes", line });
    rosterByKey.set(key, list);
  });
  if (fatal.length) return { ok: false, fatal, links: [], problems, summary: {} };

  // ---- ranking source
  const source = parseCsv(input.sourceText);
  if (!source.ok) return { ok: false, fatal: [`source: ${source.error}`], links: [], problems, summary: {} };
  const columns = input.columns || {};
  const levelColumn = column(source.header, columns.level || "level", "source");
  const rankColumn = column(source.header, columns.rank || "rank", "source");
  const keyColumn = column(source.header, columns.key || rosterColumn, "source");
  const nameColumn = columns.name ? column(source.header, columns.name, "source") : null;
  for (const item of [levelColumn, rankColumn, keyColumn, nameColumn]) if (item?.error) fatal.push(item.error);
  if (fatal.length) return { ok: false, fatal, links: [], problems, summary: {} };

  // Only the published top 10 per level can be linked.
  const candidates = new Map(); // "L:R" -> { level, rank, key, name, line }
  const keyPositions = new Map(); // key -> ["L:R", ...]
  const positionLines = new Map();
  let outsideTop10 = 0;
  source.rows.forEach((fields, offset) => {
    const line = offset + 2;
    if (fields.every((value) => value.trim() === "")) return;
    const level = Number(String(fields[levelColumn.index] ?? "").trim());
    const rank = Number(String(fields[rankColumn.index] ?? "").trim());
    if (![4, 5, 6].includes(level) || !Number.isInteger(rank) || rank < 1) {
      problems.push(`source line ${line}: level must be 4, 5 or 6 and rank a positive whole number; row skipped`);
      return;
    }
    if (rank > 10) { outsideTop10 += 1; return; }
    const position = `${level}:${rank}`;
    const key = normalizeKey(kind, fields[keyColumn.index]);
    if (positionLines.has(position)) {
      problems.push(`Level ${level} rank ${rank}: appears twice in the source (lines ${positionLines.get(position)} and ${line}); not linked`);
      candidates.set(position, { ...candidates.get(position), duplicatePosition: true });
      return;
    }
    positionLines.set(position, line);
    candidates.set(position, { level, rank, key, name: nameColumn ? fields[nameColumn.index] : undefined, line });
    if (key) keyPositions.set(key, [...(keyPositions.get(key) || []), position]);
  });

  // ---- optional published board cross-check (names never join anything)
  let published = null;
  if (input.publishedText) {
    const parsed = parseCsv(input.publishedText);
    if (!parsed.ok || parsed.header.join(",") !== "level,rank,public_name") {
      return { ok: false, fatal: ["published: expected the approved level,rank,public_name file"], links: [], problems, summary: {} };
    }
    published = new Map();
    for (const fields of parsed.rows) {
      const position = `${Number(fields[0])}:${Number(fields[1])}`;
      if (fields.length < 3 || !/^[456]:(?:[1-9]|10)$/u.test(position) || published.has(position)) {
        return { ok: false, fatal: ["published: every row needs a unique level (4-6), rank (1-10) and public_name"], links: [], problems, summary: {} };
      }
      published.set(position, fields.slice(2).join(","));
    }
    for (const position of published.keys()) {
      if (!candidates.has(position)) {
        const [level, rank] = position.split(":");
        problems.push(`Level ${level} rank ${rank}: published, but missing from the source; not linked`);
      }
    }
  }

  // Without the published file, still report every one of the 30 board
  // positions the source does not cover.
  if (!published) {
    for (const level of [4, 5, 6]) for (let rank = 1; rank <= 10; rank += 1) {
      if (!candidates.has(`${level}:${rank}`)) problems.push(`Level ${level} rank ${rank}: missing from the source; not linked`);
    }
  }

  // ---- join
  const links = [];
  const counts = { linked: 0, unmatched: 0, ambiguous: 0, ineligible: 0, missingKey: 0, invalidKey: 0, nameMismatch: 0, duplicateStudent: 0, notPublished: 0 };
  const sorted = [...candidates.values()].sort((a, b) => a.level - b.level || a.rank - b.rank);
  for (const row of sorted) {
    const where = `Level ${row.level} rank ${row.rank}`;
    if (row.duplicatePosition) { counts.ambiguous += 1; continue; }
    if (published && !published.has(`${row.level}:${row.rank}`)) {
      counts.notPublished += 1; problems.push(`${where}: not on the published board; not linked`); continue;
    }
    if (!row.key) { counts.missingKey += 1; problems.push(`${where}: no ${kind === "email" ? "email" : "reference"} in the source; not linked`); continue; }
    const invalid = keyProblem(kind, row.key);
    if (invalid) { counts.invalidKey += 1; problems.push(`${where}: the ${kind === "email" ? "email" : "reference"} ${invalid}; not linked`); continue; }
    if ((keyPositions.get(row.key) || []).length > 1) {
      counts.duplicateStudent += 1;
      problems.push(`${where}: the same student identifier appears at ${keyPositions.get(row.key).length} positions; not linked`);
      continue;
    }
    const matches = rosterByKey.get(row.key) || [];
    if (matches.length === 0) { counts.unmatched += 1; problems.push(`${where}: no roster match; not linked`); continue; }
    if (matches.length > 1) {
      counts.ambiguous += 1;
      problems.push(`${where}: matches ${matches.length} roster rows (lines ${matches.map((match) => match.line).join(", ")}); not linked`);
      continue;
    }
    if (!matches[0].eligible) { counts.ineligible += 1; problems.push(`${where}: roster row ${matches[0].line} is not eligible; not linked`); continue; }
    if (published && nameColumn) {
      const expected = normalizeName(published.get(`${row.level}:${row.rank}`));
      const actual = normalizeName(row.name);
      if (!expected || !actual || !(actual === expected || actual.startsWith(`${expected} `) || expected.startsWith(`${actual} `))) {
        counts.nameMismatch += 1;
        if (!input.allowNameMismatch) {
          problems.push(`${where}: source name differs from the published name, so the source may be a different version; not linked`);
          continue;
        }
        problems.push(`${where}: source name differs from the published name (included because of --allow-name-mismatch); check it in the preview`);
      }
    }
    links.push({ level: row.level, rank: row.rank, username: matches[0].username });
  }

  // ---- optional merge with the links already approved (kept unchanged)
  let kept = 0;
  let conflicts = 0;
  if (input.currentText) {
    const current = parseCsv(input.currentText);
    if (!current.ok || current.header.join(",") !== "level,rank,username") {
      return { ok: false, fatal: ["current: expected the level,rank,username file downloaded from Staff Desk"], links: [], problems, summary: {} };
    }
    const byPosition = new Map(links.map((link) => [`${link.level}:${link.rank}`, link]));
    const byUsername = new Map(links.map((link) => [link.username, link]));
    for (const fields of current.rows) {
      const link = { level: Number(fields[0]), rank: Number(fields[1]), username: String(fields[2] || "").trim().toLowerCase() };
      const position = `${link.level}:${link.rank}`;
      const samePosition = byPosition.get(position);
      const sameUser = byUsername.get(link.username);
      if (samePosition && samePosition.username === link.username) { kept += 1; continue; }
      if (samePosition || sameUser) {
        conflicts += 1;
        problems.push(`Level ${link.level} rank ${link.rank}: the current approved link disagrees with the new match; kept the current link and dropped the new one(s) — resolve by hand`);
        for (const drop of [samePosition, sameUser].filter(Boolean)) {
          const index = links.indexOf(drop);
          if (index >= 0) links.splice(index, 1);
          byPosition.delete(`${drop.level}:${drop.rank}`);
          byUsername.delete(drop.username);
        }
      } else kept += 1;
      links.push(link);
      byPosition.set(position, link);
      byUsername.set(link.username, link);
    }
    links.sort((a, b) => a.level - b.level || a.rank - b.rank);
  }

  counts.linked = links.length;
  return { ok: true, links, problems, summary: { ...counts, outsideTop10, keptFromCurrent: kept, conflictsWithCurrent: conflicts } };
}

export function linksToCsv(links) {
  return ["level,rank,username", ...links.map((link) => `${link.level},${link.rank},${link.username}`)].join("\n") + "\n";
}
