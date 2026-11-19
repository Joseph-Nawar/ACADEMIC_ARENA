// V1.5: How it works states the Director's Academic Score rules exactly, keeps
// scores private, and does not claim Week 5 used warnings (its source data had
// no warnings column).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const html = readFileSync(join(root, "index.html"), "utf8");
const about = html.slice(html.indexOf('<section id="page-about"'), html.indexOf("</section>\n  </main>"));
const plain = about.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("how_it_works_states_each_academic_score_rule", () => {
  assert.match(plain, /Everyone starts at zero/);
  assert.match(about, /<span class="score-chip">\+1<\/span><div><h3>Each quiz you attend/);
  assert.match(about, /<span class="score-chip">−1<\/span><div><h3>Each warning received/);
  assert.match(plain, /Normal attendance .*expected minimum, so it earns no extra points/);
  assert.match(plain, /Highest Academic Score first\. If two students are level, the one with the higher total of quiz scores goes ahead\./);
});

test("worked_example_is_arithmetically_correct", () => {
  const label = /class="score-sum" aria-label="([^"]+)"/.exec(about)?.[1];
  assert.equal(label, "Example: 5 quizzes attended is plus 5. 2 warnings is minus 2. Academic Score: 3.");
  const [quizzes, warnings, total] = [/(\d+) quizzes attended <b>\+(\d+)/, /(\d+) warnings <b>−(\d+)/, /ACADEMIC SCORE <b>(\d+)/]
    .map((pattern) => pattern.exec(about));
  assert.equal(Number(quizzes[1]), Number(quizzes[2]), "+1 per quiz");
  assert.equal(Number(warnings[1]), Number(warnings[2]), "−1 per warning");
  assert.equal(Number(total[1]), 0 + Number(quizzes[2]) - Number(warnings[2]));
});

test("scores_and_attendance_details_stay_private", () => {
  assert.match(plain, /Only names and positions are published\. Academic Scores, quiz marks, attendance and warnings are never shown\./);
  assert.match(html, /Names and positions are published by the Program Director\. Scores stay private\./);
});

test("week_5_methodology_is_described_as_verified_not_warning_adjusted", () => {
  // The Week 5 source ranked quizzes attended, then quiz scores, with no warnings data.
  assert.match(html, /<span>Ranked by quizzes attended, then quiz scores\.<\/span>/);
  assert.match(plain, /warnings weren’t part of the Week 5 data, so those boards rank quizzes attended, then quiz scores/);
  assert.doesNotMatch(html, /Ranked by Academic Score/i, "no board claims warning-adjusted ranking until approved data exists");
});

test("how_it_works_emphasises_showing_up", () => {
  assert.match(about, /SHOW UP\.<br\/><span>SCORE UP\.<\/span>/);
  assert.match(plain, /Never skip a quiz/);
  assert.match(plain, /Stay warning-free/);
});
