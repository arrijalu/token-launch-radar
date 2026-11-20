import { readFileSync, statSync } from "node:fs";
import { computeFarmPlan } from "../dashboard/farm.js";

const boardPath = "output/board.json";
const boardData = JSON.parse(readFileSync(boardPath, "utf8"));
const rows = boardData.rows;

console.log(`Verifying consistency for ${rows.length} rows...`);

let allMatch = true;
let mismatchCount = 0;

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const computed = computeFarmPlan({
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    implied_value_usd: r.implied_value_usd,
  });

  const boardSteps = r.farm_steps;
  const computedSteps = computed.steps;

  if (boardSteps.length !== computedSteps.length) {
    allMatch = false;
    mismatchCount++;
    console.log(`Row ${r.slug}: step count mismatch (${boardSteps.length} vs ${computedSteps.length})`);
    continue;
  }

  for (let s = 0; s < boardSteps.length; s++) {
    if (boardSteps[s] !== computedSteps[s]) {
      allMatch = false;
      mismatchCount++;
      console.log(`Row ${r.slug} step ${s} mismatch:\n  board:    ${boardSteps[s]}\n  computed: ${computedSteps[s]}`);
      break;
    }
  }

  if (r.farm_verdict !== computed.verdict) {
    allMatch = false;
    mismatchCount++;
    console.log(`Row ${r.slug} verdict mismatch: board ${r.farm_verdict} vs computed ${computed.verdict}`);
  }
}

console.log(`Consistency check result: allMatch = ${allMatch}, mismatches = ${mismatchCount}`);

// Print dashboard source byte totals
const files = [
  "dashboard/index.html",
  "dashboard/app.css",
  "dashboard/app.js",
  "dashboard/farm.js"
];
let totalBytes = 0;
console.log("\nDashboard source files:");
for (const f of files) {
  const size = statSync(f).size;
  totalBytes += size;
  console.log(`  ${f}: ${size} bytes`);
}
console.log(`Total dashboard source size: ${totalBytes} bytes (${(totalBytes / 1024).toFixed(1)} KB) — limit 58 KB`);

// Print screenshot byte sizes
const shots = [
  "screenshots/1-board.png",
  "screenshots/2-detail.png",
  "screenshots/3-filtered.png"
];
console.log("\nScreenshots:");
for (const s of shots) {
  const size = statSync(s).size;
  console.log(`  ${s}: ${size} bytes (${(size / 1024).toFixed(1)} KB)`);
}
