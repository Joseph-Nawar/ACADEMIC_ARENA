// Operator-only, offline: build the private `level,rank,username` file for
// Staff Desk → Verified account links from the official ranking source and
// the private roster. Runs on the operator's device; makes no network calls;
// prints counts and positions only (never identifiers, names, emails or
// usernames). It approves nothing: upload the result in Staff Desk, check the
// private preview, and approve with your TOTP check.
//
//   node scripts/build-link-csv.mjs \
//     --source /private/week5-source.csv --roster /private/roster.csv \
//     --key email|roster-ref --out /private/week5-links.csv \
//     [--source-level-column level] [--source-rank-column rank] \
//     [--source-key-column email|student_id] \
//     --published /private/week5-published.csv --source-name-column name \
//     [--current /private/links-v1.csv] [--allow-name-mismatch] [--no-published-check]
//
// See docs/operations/verified-links-runbook.md.
import { readFileSync, writeFileSync, realpathSync, existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildLinks, linksToCsv } from "./lib/link-csv-builder.mjs";
import { parseLinkCsv } from "../functions/lib/leaderboard-csv.js";

const die = (message) => { console.error(`error: ${message}`); process.exit(2); };

const { values } = parseArgs({
  options: {
    source: { type: "string" }, roster: { type: "string" }, key: { type: "string" }, out: { type: "string" },
    published: { type: "string" }, current: { type: "string" },
    "source-level-column": { type: "string" }, "source-rank-column": { type: "string" },
    "source-key-column": { type: "string" }, "source-name-column": { type: "string" },
    "allow-name-mismatch": { type: "boolean" }, "no-published-check": { type: "boolean" },
  },
  strict: true,
});
for (const name of ["source", "roster", "key", "out"]) if (!values[name]) die(`--${name} is required`);
// Usernames are opaque, so the Staff Desk preview cannot reveal that the source
// was a different version of the ranking. This check can; it only removes rows.
if (values["no-published-check"] !== true && !(values.published && values["source-name-column"])) {
  die("--published and --source-name-column are required (a cross-check only, never a join key); pass --no-published-check to skip it knowingly");
}

// Private files never live inside any git checkout (this one, the main one, a
// clone or a worktree) or a folder that syncs to the cloud.
const SYNCED = /\/(?:Mobile Documents|CloudStorage|Dropbox[^/]*|OneDrive[^/]*|Google ?Drive[^/]*|iCloud ?Drive)(?:\/|$)/iu;
function unsafeLocation(file) {
  const resolved = path.resolve(file);
  let real;
  try {
    real = existsSync(resolved) ? realpathSync(resolved) : path.join(realpathSync(path.dirname(resolved)), path.basename(resolved));
  } catch {
    return "is in a folder that does not exist";
  }
  if (SYNCED.test(real) || SYNCED.test(resolved)) return "must not be in a cloud-synced folder";
  for (let dir = path.dirname(real); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, ".git"))) return "must be outside every git repository";
    if (dir === path.dirname(dir)) return null;
  }
}
for (const name of ["source", "roster", "published", "current", "out"]) {
  const problem = values[name] && unsafeLocation(values[name]);
  if (problem) die(`--${name} ${problem}`);
}
if (existsSync(values.out)) die("--out must name a new file");

const read = (file, label) => {
  try { return readFileSync(file, "utf8"); } catch { return die(`cannot read the ${label} file`); }
};
const result = buildLinks({
  sourceText: read(values.source, "source"),
  rosterText: read(values.roster, "roster"),
  publishedText: values.published ? read(values.published, "published") : undefined,
  currentText: values.current ? read(values.current, "current links") : undefined,
  key: values.key,
  columns: {
    level: values["source-level-column"], rank: values["source-rank-column"],
    key: values["source-key-column"], name: values["source-name-column"],
  },
  allowNameMismatch: values["allow-name-mismatch"] === true,
});
if (!result.ok) {
  for (const message of result.fatal) console.error(`error: ${message}`);
  die("nothing was written");
}

// The file must pass exactly the checks the Staff Desk upload applies.
const csv = linksToCsv(result.links);
const check = parseLinkCsv(csv);
if (!check.ok) {
  for (const item of check.errors) console.error(`error: generated line ${item.line}: ${item.message}`);
  die("the generated file would be rejected by Staff Desk; nothing was written");
}
writeFileSync(values.out, csv, { mode: 0o600, flag: "wx" });

const s = result.summary;
console.log(`Wrote ${result.links.length} of 30 link(s) to the output file (private: keep it with the roster, never upload it anywhere except Staff Desk).`);
console.log(`Summary: linked ${s.linked}, no roster match ${s.unmatched}, ambiguous ${s.ambiguous}, same student twice ${s.duplicateStudent}, ` +
  `not eligible ${s.ineligible}, missing identifier ${s.missingKey}, unusable identifier ${s.invalidKey}, name check failed ${s.nameMismatch}, not published ${s.notPublished}, ` +
  `ranks below 10 ignored ${s.outsideTop10}${values.current ? `, kept from current ${s.keptFromCurrent}, conflicts ${s.conflictsWithCurrent}` : ""}.`);
for (const problem of result.problems) console.log(`- ${problem}`);
console.log("Next: Staff Desk → Verified account links → preview this file, check every row, then approve with your TOTP check.");
process.exit(result.problems.length ? 1 : 0);
