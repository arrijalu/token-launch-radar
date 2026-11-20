// main.ts — the radar program.
//
// Reads the sealed DeFi snapshot, classifies every protocol, fits and selects
// the value model, ranks the pre-token protocols, prices a farm plan for each
// board row with dashboard/farm.js, and writes the board, the dashboard data,
// the dashboard and screenshot copies, and the dossier.
//
// Node 22, standard library only, no network, deterministic: two runs over the
// same snapshot write byte-identical output trees.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleBoard,
  buildCensus,
  buildDashboardData,
  fitSample,
  makeCandidateContext,
  parseSnapshot,
  runSelfChecks,
  scoreCandidates,
  selectWinner,
  walkForward,
} from "./lib/model.ts";
import { computeFarmPlan } from "./dashboard/farm.js";
import { buildDossier } from "./vendor/makefun-board.ts";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = "/input";

function fail(message: string): never {
  process.stderr.write("radar: " + message + "\n");
  process.exit(1);
}

/** The snapshot file: --input may name the file or the directory holding it. */
function resolveInput(argv: string[]): string {
  let value: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") {
      value = argv[i + 1] ?? null;
      i++;
    } else if (a.startsWith("--input=")) {
      value = a.slice("--input=".length);
    }
  }
  if (value === null) value = process.env.MAKEFUN_INPUT ?? DEFAULT_INPUT;
  const p = resolve(value);
  if (existsSync(p) && statSync(p).isDirectory()) return join(p, "snapshot.json");
  return p;
}

/** The output directory: the first positional argument, else the env var, else ./output. */
function resolveOutput(argv: string[]): string {
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") {
      i++;
      continue;
    }
    if (a.startsWith("--")) continue;
    positional.push(a);
  }
  const chosen = positional[0] ?? process.env.MAKEFUN_OUTPUT_DIR ?? "./output";
  return resolve(chosen);
}

/** Copy a directory's files (flat or nested) into the output, deterministically. */
function copyTree(from: string, to: string): void {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  const walk = (rel: string): void => {
    const src = rel === "" ? from : join(from, rel);
    const entries = readdirSync(src, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const childRel = rel === "" ? e.name : join(rel, e.name);
      if (e.isDirectory()) {
        mkdirSync(join(to, childRel), { recursive: true });
        walk(childRel);
      } else if (e.isFile()) {
        copyFileSync(join(from, childRel), join(to, childRel));
      }
    }
  };
  walk("");
}

/** The gate's farm-step shape, enforced on every row before anything is written. */
function checkFarmSteps(rows: { slug: string; farm_steps: string[] }[]): void {
  for (const row of rows) {
    const steps = row.farm_steps;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) {
      fail(`row ${row.slug} has ${Array.isArray(steps) ? steps.length : 0} farm steps, outside 3..12`);
    }
    for (const s of steps) {
      if (typeof s !== "string") fail(`row ${row.slug} has a non-string farm step`);
      const t = s.trim();
      if (t.length < 20 || t.length > 600) fail(`row ${row.slug} has a farm step of ${t.length} characters, outside 20..600`);
    }
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputPath = resolveInput(argv);
  const outputDir = resolveOutput(argv);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (err) {
    fail(`cannot read the snapshot at ${inputPath}: ${(err as Error).message}`);
  }

  const snapshot = parseSnapshot(raw);
  const census = buildCensus(snapshot.protocols);
  const ctx = makeCandidateContext(fitSample(snapshot.protocols), snapshot.as_of);
  const winner = selectWinner(ctx);
  const wf = walkForward(ctx, winner.winnerName);
  const candidateScores = scoreCandidates(ctx);
  const rows = assembleBoard(snapshot, census, ctx, winner.winnerName, 200);
  runSelfChecks(rows, census, snapshot);

  // One farm plan per board row, from the same module the page loads.
  const boardRows = rows.map((r) => {
    const plan = computeFarmPlan(
      {
        slug: r.slug,
        name: r.name,
        category: r.category,
        chains: r.chains,
        tvl_usd: r.tvl_usd,
        implied_value_usd: r.implied_value_usd,
      },
      { as_of: snapshot.as_of },
    );
    return {
      ...r,
      farm_steps: plan.steps,
      farm_verdict: plan.verdict,
      farm_deposit_usd: plan.deposit_usd,
      farm_expected_net_usd: plan.expected_net_usd,
    };
  });
  checkFarmSteps(boardRows);

  const data = buildDashboardData(snapshot, census, ctx, winner, wf, boardRows, candidateScores);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "board.json"), JSON.stringify({ rows: boardRows }, null, 2) + "\n", "utf8");
  writeFileSync(join(outputDir, "data.js"), "window.RADAR = " + JSON.stringify(data) + ";\n", "utf8");

  copyTree(join(REPO_ROOT, "dashboard"), join(outputDir, "dashboard"));
  copyTree(join(REPO_ROOT, "screenshots"), join(outputDir, "screenshots"));

  const dossier = buildDossier(outputDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  writeFileSync(join(outputDir, "dossier.json"), Buffer.from(dossier), undefined);

  const counts = { FARM: 0, THIN: 0, SKIP: 0 } as Record<string, number>;
  for (const r of boardRows) counts[r.farm_verdict] = (counts[r.farm_verdict] ?? 0) + 1;
  process.stdout.write(
    `radar: ${boardRows.length} rows, winner ${winner.winnerName} (LOO median ${winner.scores.looMedian.toFixed(3)}), ` +
      `farm FARM ${counts.FARM} / THIN ${counts.THIN} / SKIP ${counts.SKIP} -> ${outputDir}\n`,
  );
}

main();
