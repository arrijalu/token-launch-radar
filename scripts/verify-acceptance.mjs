import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const scratch1 = "/tmp/scratch-1";
const scratch2 = "/tmp/scratch-2";
const input = "/home/hermes/kit-token-radar/input/snapshot.json";

rmSync(scratch1, { recursive: true, force: true });
rmSync(scratch2, { recursive: true, force: true });

execSync(`/usr/local/bin/node22 main.ts --input ${input} ${scratch1}`, { stdio: "inherit" });
execSync(`/usr/local/bin/node22 main.ts --input ${input} ${scratch2}`, { stdio: "inherit" });

let diffOut = "";
try {
  execSync(`diff -r ${scratch1} ${scratch2}`, { stdio: "pipe" });
  diffOut = "clean";
} catch (e) {
  diffOut = e.stdout?.toString() || "diff failed";
}
console.log(`diff -r scratch-1 scratch-2: ${diffOut}`);

const board1 = JSON.parse(readFileSync(join(scratch1, "board.json"), "utf8")).rows;
const boardVerify = JSON.parse(readFileSync("/tmp/verify-a/board.json", "utf8")).rows;
const boardFinal = JSON.parse(readFileSync("/tmp/final-a/board.json", "utf8")).rows;

// 1. Type of rank_p10
const allInt = board1.every(r => Number.isInteger(r.rank_p10) && Number.isInteger(r.rank_p90));
console.log(`rank_p10 / rank_p90 are all integers (int type): ${allInt}`);

// 2. Zero-width range count
const widths = board1.map(r => r.rank_p90 - r.rank_p10);
const zeroWidthCount = widths.filter(w => w === 0).length;
console.log(`Zero-width range count: ${zeroWidthCount}`);

// 3. Width min/median/max
widths.sort((a, b) => a - b);
const minWidth = widths[0];
const maxWidth = widths[widths.length - 1];
const medianWidth = widths.length % 2 === 1 ? widths[Math.floor(widths.length / 2)] : (widths[widths.length / 2 - 1] + widths[widths.length / 2]) / 2;
console.log(`Width min: ${minWidth}, median: ${medianWidth}, max: ${maxWidth}`);

// 4. Top-3 rows with rank [p10-p90]
console.log("Top-3 rows:");
for (let i = 0; i < Math.min(3, board1.length); i++) {
  const r = board1[i];
  console.log(`  Rank ${r.rank} (${r.slug}): [${r.rank_p10} - ${r.rank_p90}] (implied $${r.implied_mcap_usd})`);
}

// 5. Confirmation vs /tmp/final-a/board.json
let slugOrderOk = true;
let impliedValOk = true;
let impliedP10Ok = true;
let impliedP90Ok = true;

for (let i = 0; i < board1.length; i++) {
  if (board1[i].slug !== boardFinal[i].slug) slugOrderOk = false;
  if (board1[i].implied_value_usd !== boardFinal[i].implied_value_usd) impliedValOk = false;
  if (board1[i].implied_p10 !== boardFinal[i].implied_p10) impliedP10Ok = false;
  if (board1[i].implied_p90 !== boardFinal[i].implied_p90) impliedP90Ok = false;
}
console.log(`Slug order identical to final-a: ${slugOrderOk}`);
console.log(`implied_value_usd identical to final-a: ${impliedValOk}`);
console.log(`implied_p10 identical to final-a: ${impliedP10Ok}`);
console.log(`implied_p90 identical to final-a: ${impliedP90Ok}`);

// 6. Confirmation vs /tmp/verify-a/board.json (rounded check)
let roundingMatchOk = true;
for (let i = 0; i < board1.length; i++) {
  const expectedP10 = Math.max(1, Math.min(198, Math.round(boardVerify[i].rank_p10)));
  let expectedP90 = Math.max(1, Math.min(198, Math.round(boardVerify[i].rank_p90)));
  if (expectedP10 > expectedP90) expectedP90 = expectedP10;
  if (board1[i].rank_p10 !== expectedP10 || board1[i].rank_p90 !== expectedP90) {
    roundingMatchOk = false;
    console.log(`Mismatch at index ${i} (${board1[i].slug}): got [${board1[i].rank_p10}, ${board1[i].rank_p90}], expected rounded [${expectedP10}, ${expectedP90}] (raw was [${boardVerify[i].rank_p10}, ${boardVerify[i].rank_p90}])`);
    break;
  }
}
console.log(`rank_p10/rank_p90 equal rounded values of verify-a: ${roundingMatchOk}`);
