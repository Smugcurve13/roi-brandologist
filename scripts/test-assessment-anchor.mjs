import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../js/main.js", import.meta.url), "utf8");

assert.match(source, /const ASSESSMENT_HASH = "#exhibition-roi-assessment"/);
assert.match(source, /function landOnAssessment\(\)/);
assert.match(source, /root\.style\.scrollBehavior = "auto"/);
assert.match(source, /window\.scrollTo\(0, Math\.max\(0, section\.getBoundingClientRect\(\)\.top/);
assert.match(source, /event\.preventDefault\(\)/);
assert.match(source, /history\.pushState\(null, "", ASSESSMENT_HASH\)/);
assert.match(source, /window\.addEventListener\("hashchange", handleAssessmentHash\)/);
assert.match(source, /window\.addEventListener\("load", handleAssessmentHash\)/);

console.log("assessment anchor wiring: OK");
