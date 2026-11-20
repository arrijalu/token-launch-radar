import { readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { computeFarmPlan } from "../dashboard/farm.js";

console.log("1. Running pipeline with /usr/local/bin/node22...");
execSync("/usr/local/bin/node22 main.ts --input /home/hermes/kit-token-radar/input/snapshot.json", { stdio: "inherit" });

console.log("\n2. Running consistency verification for all 198 rows...");
const boardData = JSON.parse(readFileSync("output/board.json", "utf8"));
const rows = boardData.rows;

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
      console.log(`Row ${r.slug} step ${s} mismatch`);
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
if (!mismatchCount) {
  console.log("✓ All 198 rows match dashboard/farm.js exactly.");
}

console.log("\n3. Dashboard Source Byte Total:");
const dashboardFiles = [
  "dashboard/index.html",
  "dashboard/app.css",
  "dashboard/app.js",
  "dashboard/farm.js"
];
let totalDashboardBytes = 0;
for (const f of dashboardFiles) {
  const size = statSync(f).size;
  totalDashboardBytes += size;
  console.log(`  - ${f}: ${size} bytes`);
}
console.log(`Total Dashboard Source: ${totalDashboardBytes} bytes (${(totalDashboardBytes / 1024).toFixed(1)} KB) — limit 58 KB`);

console.log("\n4. Screenshot Byte Sizes and Dimensions:");
const screenshots = [
  "screenshots/1-board.png",
  "screenshots/2-detail.png",
  "screenshots/3-filtered.png"
];

for (const s of screenshots) {
  const buf = readFileSync(s);
  const size = buf.length;
  // Read PNG dimensions from IHDR chunk (offset 16 for width, 20 for height)
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  console.log(`  - ${s}: ${size} bytes (${(size / 1024).toFixed(1)} KB), dimensions: ${width}x${height}`);
}
