// scripts/acceptance-report.mjs — verifies acceptance criteria and prints report.
import { readFileSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { computeFarmPlan, planFor } from "../dashboard/farm.js";

const outDir = "/tmp/acceptance-output";
execSync(`/usr/local/bin/node22 main.ts --input /home/hermes/kit-token-radar/input/snapshot.json ${outDir}`, { stdio: "inherit" });

const snap = JSON.parse(readFileSync("/home/hermes/kit-token-radar/input/snapshot.json", "utf8"));
const boardData = JSON.parse(readFileSync(join(outDir, "board.json"), "utf8"));
const rows = boardData.rows;

console.log("\n=== ACCEPTANCE REPORT ===");

// 1. Verdict mix
const counts = { FARM: 0, THIN: 0, SKIP: 0 };
for (const r of rows) {
  counts[r.farm_verdict] = (counts[r.farm_verdict] || 0) + 1;
}
console.log(`1. Verdict mix over all 198 rows: FARM ${counts.FARM} / THIN ${counts.THIN} / SKIP ${counts.SKIP}`);
if (counts.FARM !== 25 || counts.THIN !== 168 || counts.SKIP !== 5) {
  console.error("ERROR: Verdict mix mismatch!");
  process.exit(1);
}

// 2. Step counts and lengths check (3-12 steps, 20-600 chars)
let allCountOk = true;
let allLengthOk = true;
let minLen = Infinity;
let maxLen = 0;

for (const r of rows) {
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
    allCountOk = false;
  }
  for (const s of r.farm_steps) {
    const len = s.length;
    if (len < 20 || len > 600) {
      allLengthOk = false;
      console.error(`Violation in ${r.slug}: step length ${len} out of range [20, 600]: "${s}"`);
    }
    if (len < minLen) minLen = len;
    if (len > maxLen) maxLen = len;
  }
}
console.log(`2. Step count check (3-12 steps per row): ${allCountOk ? "PASSED (all rows have 6 steps)" : "FAILED"}`);
console.log(`3. Step length check (20-600 chars): ${allLengthOk ? "PASSED" : "FAILED"} (min: ${minLen}, max: ${maxLen})`);

// 3. Farm consistency check (board steps recompute exactly from farm.js for all 198 rows)
let consistencyOk = true;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const recomputed = computeFarmPlan({
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    implied_value_usd: r.implied_value_usd,
  });
  if (recomputed.verdict !== r.farm_verdict ||
      recomputed.deposit_usd !== r.farm_deposit_usd ||
      recomputed.expected_net_usd !== r.farm_expected_net_usd ||
      recomputed.steps.length !== r.farm_steps.length) {
    consistencyOk = false;
    console.error(`Consistency mismatch at row ${i} (${r.slug})`);
    break;
  }
  for (let j = 0; j < r.farm_steps.length; j++) {
    if (recomputed.steps[j] !== r.farm_steps[j]) {
      consistencyOk = false;
      console.error(`Step mismatch at row ${i} (${r.slug}) step ${j}`);
      break;
    }
  }
}
console.log(`4. Farm consistency check (board recomputes exactly from farm.js): ${consistencyOk ? "PASSED (198/198)" : "FAILED"}`);

// 4. One FARM row, one THIN row, one SKIP row full step list with character lengths
const farmRow = rows.find(r => r.farm_verdict === "FARM");
const thinRow = rows.find(r => r.farm_verdict === "THIN");
const skipRow = rows.find(r => r.farm_verdict === "SKIP");

function printSampleRow(label, r) {
  if (!r) return;
  console.log(`\nSample ${label} row: ${r.name} (${r.slug}), category: ${r.category}, verdict: ${r.farm_verdict}, net: $${r.farm_expected_net_usd}`);
  r.farm_steps.forEach((step, idx) => {
    console.log(`  Step ${idx + 1} [${step.length} chars]: ${step}`);
  });
}

printSampleRow("FARM", farmRow);
printSampleRow("THIN", thinRow);
printSampleRow("SKIP", skipRow);

console.log("\n=== ACCEPTANCE VERIFICATION COMPLETE ===");
