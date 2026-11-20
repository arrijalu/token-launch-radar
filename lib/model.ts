// lib/model.ts — snapshot parsing, census, features, fitted value models.
// First half: everything up to and including exact leave-one-out scoring of
// the four candidate models. Board assembly / walk-forward / bootstrap are
// added by a later session to this same file.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number | null;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export type CensusClass =
  | "HAS_TOKEN"
  | "PRODUCT_OF_TRADED"
  | "EXCHANGE_PRODUCT"
  | "WRAPPED_STAKED_NAME"
  | "VERSIONED_PRODUCT"
  | "PRE_TOKEN";

export const CENSUS_CLASSES: CensusClass[] = [
  "HAS_TOKEN",
  "PRODUCT_OF_TRADED",
  "EXCHANGE_PRODUCT",
  "WRAPPED_STAKED_NAME",
  "VERSIONED_PRODUCT",
  "PRE_TOKEN",
];

export interface CensusEntry {
  slug: string;
  name: string;
  category: string;
  cls: CensusClass;
  reason: string;
}

export interface CensusResult {
  entries: CensusEntry[];
  bySlug: Map<string, CensusEntry>;
  counts: Record<CensusClass, number>;
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Linear-interpolated quantile of an unsorted array, q in [0,1]. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  const t = pos - lo;
  return s[lo] * (1 - t) + s[hi] * t;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + "T00:00:00Z");
  const b = Date.parse(toISO + "T00:00:00Z");
  return (b - a) / 86400000;
}

// ---------------------------------------------------------------------------
// Snapshot parsing / validation
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Coerce a numeric field: finite numbers pass, non-finite or bad types become null. */
function numOrNull(v: unknown, _field: string, _slug: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function parseSnapshot(raw: unknown): Snapshot {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SnapshotError("snapshot root must be an object");
  }
  const o = raw as Record<string, unknown>;

  const as_of = o.as_of;
  if (typeof as_of !== "string" || !ISO_DATE.test(as_of)) {
    throw new SnapshotError("snapshot.as_of must be a YYYY-MM-DD string");
  }
  const source = o.source;
  if (typeof source !== "string" || source.trim() === "") {
    throw new SnapshotError("snapshot.source must be a non-empty string");
  }
  const floor_usd = o.floor_usd;
  if (typeof floor_usd !== "number" || !Number.isFinite(floor_usd)) {
    throw new SnapshotError("snapshot.floor_usd must be a finite number");
  }
  if (!Array.isArray(o.protocols)) {
    throw new SnapshotError("snapshot.protocols must be an array");
  }
  if (!Array.isArray(o.watchlist)) {
    throw new SnapshotError("snapshot.watchlist must be an array of slugs");
  }

  const seen = new Set<string>();
  const protocols: SnapshotProtocol[] = (o.protocols as unknown[]).map((entry, idx) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new SnapshotError(`protocol #${idx} must be an object`);
    }
    const p = entry as Record<string, unknown>;
    const slug = p.slug;
    if (typeof slug !== "string" || slug.trim() === "") {
      throw new SnapshotError(`protocol #${idx}: slug must be a non-empty string`);
    }
    if (seen.has(slug)) {
      throw new SnapshotError(`duplicate protocol slug: ${slug}`);
    }
    seen.add(slug);
    const name = typeof p.name === "string" && p.name.trim() !== "" ? p.name : slug;
    const category = typeof p.category === "string" && p.category.trim() !== "" ? p.category : "Unknown";
    const chains = Array.isArray(p.chains)
      ? (p.chains as unknown[]).filter((c): c is string => typeof c === "string")
      : [];
    const listed = p.listed_at === null || p.listed_at === undefined ? null : p.listed_at;
    if (listed !== null && (typeof listed !== "string" || !ISO_DATE.test(listed))) {
      throw new SnapshotError(`protocol ${slug}: listed_at must be YYYY-MM-DD or null`);
    }
    return {
      slug,
      name,
      category,
      chains,
      tvl_usd: numOrNull(p.tvl_usd, "tvl_usd", slug),
      change_7d: numOrNull(p.change_7d, "change_7d", slug),
      mcap_usd: numOrNull(p.mcap_usd, "mcap_usd", slug),
      listed_at: listed as string | null,
      gecko_id: strOrNull(p.gecko_id),
      symbol: strOrNull(p.symbol),
    };
  });

  const watchlist = (o.watchlist as unknown[]).map((s, i) => {
    if (typeof s !== "string" || s.trim() === "") {
      throw new SnapshotError(`watchlist[${i}] must be a non-empty slug string`);
    }
    return s;
  });

  return { as_of, source, floor_usd, protocols, watchlist };
}

// ---------------------------------------------------------------------------
// Census (classification cascade)
// ---------------------------------------------------------------------------

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const TRADED_PRODUCT_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const EXCHANGE_NAMES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
].map(normalizeName);

const WRAPPED_WORDS = new Set(["wrapped", "staked", "staking"]);
const VERSION_SUFFIX = /\s(v\d+(\.\d+)?|\d+\.\d+)$/;

function matchingExchange(normName: string): string | null {
  for (const ex of EXCHANGE_NAMES) {
    if (normName === ex || normName.startsWith(ex + " ")) return ex;
  }
  return null;
}

function hasWrappedWord(normName: string): string | null {
  for (const word of normName.split(" ")) {
    if (WRAPPED_WORDS.has(word)) return word;
  }
  return null;
}

export function classify(p: SnapshotProtocol): { cls: CensusClass; reason: string } {
  const norm = normalizeName(p.name);

  if (p.symbol !== null || p.gecko_id !== null) {
    return { cls: "HAS_TOKEN", reason: "records a token (symbol or gecko id set)" };
  }
  if (TRADED_PRODUCT_CATEGORIES.has(p.category)) {
    return {
      cls: "PRODUCT_OF_TRADED",
      reason: `category ${p.category}: a product of a traded token's system`,
    };
  }
  const ex = matchingExchange(norm);
  if (ex !== null) {
    return {
      cls: "EXCHANGE_PRODUCT",
      reason: `name carries exchange venue "${ex}": a product of a traded token's system`,
    };
  }
  const wrapped = hasWrappedWord(norm);
  if (wrapped !== null) {
    return {
      cls: "WRAPPED_STAKED_NAME",
      reason: `name marks a "${wrapped}" derivative of a traded token`,
    };
  }
  if (VERSION_SUFFIX.test(norm)) {
    return { cls: "VERSIONED_PRODUCT", reason: "name carries a version marker on a product line" };
  }
  return { cls: "PRE_TOKEN", reason: "no token recorded; survives every product rule" };
}

export function buildCensus(protocols: SnapshotProtocol[]): CensusResult {
  const counts = {} as Record<CensusClass, number>;
  for (const c of CENSUS_CLASSES) counts[c] = 0;
  const entries: CensusEntry[] = [];
  const bySlug = new Map<string, CensusEntry>();
  for (const p of protocols) {
    const { cls, reason } = classify(p);
    counts[cls] += 1;
    const entry: CensusEntry = { slug: p.slug, name: p.name, category: p.category, cls, reason };
    entries.push(entry);
    bySlug.set(p.slug, entry);
  }
  return { entries, bySlug, counts };
}

// ---------------------------------------------------------------------------
// Feature builder
// ---------------------------------------------------------------------------

export const FIT_MIN_CATEGORY_ROWS = 5;

export interface FeatureSpec {
  as_of: string;
  /** labels for the six base features (intercept first) */
  baseLabels: string[];
  /** categories that receive a dummy (>= 5 fit rows), sorted */
  dummyCategories: string[];
  /** median age in years over fit rows that record listed_at */
  medianAgeYears: number;
  /** number of fit rows the spec was derived from */
  fitRowCount: number;
  /** count of fit rows per dummy category */
  categoryRows: Map<string, number>;
}

export interface FitRow {
  p: SnapshotProtocol;
  y: number; // ln(mcap_usd)
  x: number[];
}

export const BASE_LABELS = [
  "intercept",
  "ln(tvl)",
  "growth_7d",
  "growth_null",
  "ln(1+age_years)",
  "age_null",
];

export function ageYears(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  return daysBetween(p.listed_at, asOf) / 365.25;
}

export function fitSample(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter(
    (p) => p.mcap_usd !== null && Number.isFinite(p.mcap_usd) && p.mcap_usd > 0,
  );
}

export function makeFeatureSpec(fitRows: SnapshotProtocol[], asOf: string): FeatureSpec {
  const ages: number[] = [];
  const catCounts = new Map<string, number>();
  for (const p of fitRows) {
    const a = ageYears(p, asOf);
    if (a !== null && Number.isFinite(a)) ages.push(a);
    catCounts.set(p.category, (catCounts.get(p.category) ?? 0) + 1);
  }
  const dummyCategories = [...catCounts.entries()]
    .filter(([, n]) => n >= FIT_MIN_CATEGORY_ROWS)
    .map(([c]) => c)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    as_of: asOf,
    baseLabels: BASE_LABELS.slice(),
    dummyCategories,
    medianAgeYears: ages.length > 0 ? median(ages) : 0,
    fitRowCount: fitRows.length,
    categoryRows: catCounts,
  };
}

export function featureLabels(spec: FeatureSpec): string[] {
  return [...spec.baseLabels, ...spec.dummyCategories.map((c) => `cat:${c}`)];
}

/** Feature vector for the full model (base + category dummies). */
export function featureVector(p: SnapshotProtocol, spec: FeatureSpec): number[] {
  const tvl = p.tvl_usd !== null && Number.isFinite(p.tvl_usd) ? p.tvl_usd : 0;
  const change = p.change_7d !== null && Number.isFinite(p.change_7d) ? p.change_7d : null;
  const age = ageYears(p, spec.as_of);
  const g = change === null ? 0 : clamp(change, -50, 100) / 100;
  const dG = change === null ? 1 : 0;
  const ageVal = age === null ? spec.medianAgeYears : Math.max(age, 0);
  const dAge = age === null ? 1 : 0;

  const x = [
    1,
    Math.log(Math.max(tvl, 1)),
    g,
    dG,
    Math.log(1 + ageVal),
    dAge,
  ];
  for (const c of spec.dummyCategories) x.push(p.category === c ? 1 : 0);
  return x;
}

/** Size candidate: intercept + ln(tvl) only. */
export function sizeVector(p: SnapshotProtocol): number[] {
  const tvl = p.tvl_usd !== null && Number.isFinite(p.tvl_usd) ? p.tvl_usd : 0;
  return [1, Math.log(Math.max(tvl, 1))];
}

export function buildFitRows(protocols: SnapshotProtocol[], spec: FeatureSpec): FitRow[] {
  return protocols.map((p) => ({
    p,
    y: Math.log(p.mcap_usd as number),
    x: featureVector(p, spec),
  }));
}

// ---------------------------------------------------------------------------
// Cholesky ridge solver
// ---------------------------------------------------------------------------

/**
 * Solve A x = b for symmetric positive semi-definite A by Cholesky.
 * Pivots are floored and a relative diagonal jitter is added first, so a
 * rank-deficient system (a feature column going constant on a LOO subset)
 * yields a finite least-norm-ish answer instead of throwing.
 */
export function choleskySolve(A: number[][], b: number[]): number[] {
  const n = A.length;
  if (n === 0) return [];

  let maxDiag = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(A[i][i]);
    if (Number.isFinite(d) && d > maxDiag) maxDiag = d;
  }
  const jitter = (maxDiag > 0 ? maxDiag : 1) * 1e-10;

  const L: number[][] = [];
  for (let i = 0; i < n; i++) L.push(new Array<number>(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j] - (i === j ? -jitter : 0);
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        L[i][j] = Math.sqrt(Math.max(sum, 1e-12));
      } else {
        const pj = L[j][j];
        L[i][j] = pj > 1e-12 ? sum / pj : 0;
      }
    }
  }

  // forward substitution: L z = b
  const z = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * z[k];
    z[i] = L[i][i] > 1e-12 ? s / L[i][i] : 0;
  }
  // back substitution: L^T x = z
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = L[i][i] > 1e-12 ? s / L[i][i] : 0;
  }
  return x.map((v) => (Number.isFinite(v) ? v : 0));
}

/** Weighted ridge solve on the normal equations X^T W X + diag(pen). */
export function weightedRidgeSolve(
  X: number[][],
  y: number[],
  w: number[],
  pen: number[],
): number[] {
  const k = pen.length;
  const A: number[][] = [];
  for (let i = 0; i < k; i++) A.push(new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);

  for (let r = 0; r < X.length; r++) {
    const wr = w[r];
    if (!(wr > 0)) continue;
    const row = X[r];
    const yr = y[r];
    for (let i = 0; i < k; i++) {
      const xi = row[i];
      if (xi === 0) continue;
      b[i] += wr * xi * yr;
      for (let j = 0; j <= i; j++) A[i][j] += wr * xi * row[j];
    }
  }
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < i; j++) A[j][i] = A[i][j];
    A[i][i] += pen[i];
  }
  return choleskySolve(A, b);
}

// ---------------------------------------------------------------------------
// Fitted models
// ---------------------------------------------------------------------------

export type CandidateName = "size" | "growth-age" | "huber-ridge" | "category-medians";

export const CANDIDATE_ORDER: CandidateName[] = [
  "size",
  "growth-age",
  "huber-ridge",
  "category-medians",
];

export interface Receipt {
  label: string;
  value: number;
  coefficient: number | null;
  contribution: number | null;
}

export interface FittedModel {
  name: CandidateName;
  paramCount: number;
  /** log implied value for a protocol */
  predictLog(p: SnapshotProtocol): number;
  /** implied USD value for a protocol */
  predict(p: SnapshotProtocol): number;
  /** per-feature receipt (labels, values, coefficients, contributions) */
  receipt(p: SnapshotProtocol): Receipt[];
  /** coefficients with labels, for the model report */
  coefficients: { label: string; value: number }[];
  /** extra report metadata (e.g. chosen ridge lambda) */
  meta: Record<string, number | string>;
}

function linearPredictLog(x: number[], beta: number[]): number {
  let s = 0;
  for (let i = 0; i < beta.length && i < x.length; i++) s += x[i] * beta[i];
  return Number.isFinite(s) ? s : 0;
}

function linearReceipt(x: number[], beta: number[], labels: string[], values: number[]): Receipt[] {
  const out: Receipt[] = [];
  for (let i = 0; i < beta.length; i++) {
    out.push({
      label: labels[i] ?? `f${i}`,
      value: values[i] ?? x[i],
      coefficient: beta[i],
      contribution: x[i] * beta[i],
    });
  }
  return out;
}

const HUBER_DELTA = 1.5;
const HUBER_ITERATIONS = 5;
const HUBER_SCALE_FLOOR = 1e-6;

/** Penalty vector: intercept 0, base features λ, dummy c: λ·(fitN / n_c). */
export function ridgePenalties(
  lambda: number,
  labels: string[],
  spec: FeatureSpec,
): number[] {
  return labels.map((label) => {
    if (label === "intercept") return 0;
    if (label.startsWith("cat:")) {
      const c = label.slice(4);
      const n = spec.categoryRows.get(c) ?? 0;
      return n > 0 ? lambda * (spec.fitRowCount / n) : lambda;
    }
    return lambda;
  });
}

export function fitLinear(
  rows: FitRow[],
  penalty: number[],
  huber: boolean,
): { beta: number[]; weights: number[] } {
  const X = rows.map((r) => r.x);
  const y = rows.map((r) => r.y);
  let weights = new Array<number>(rows.length).fill(1);
  let beta = weightedRidgeSolve(X, y, weights, penalty);

  if (!huber) return { beta, weights };

  for (let iter = 0; iter < HUBER_ITERATIONS; iter++) {
    const resid = X.map((x, i) => y[i] - linearPredictLog(x, beta));
    const scale = Math.max(1.4826 * median(resid.map((r) => Math.abs(r))), HUBER_SCALE_FLOOR);
    weights = resid.map((r) => {
      const ar = Math.abs(r);
      if (!(ar > 0)) return 1;
      return Math.min(1, (HUBER_DELTA * scale) / ar);
    });
    beta = weightedRidgeSolve(X, y, weights, penalty);
  }
  return { beta, weights };
}

export interface CategoryMedianFit {
  globalLogMultiple: number;
  categoryLogMultiple: Map<string, number>;
  counts: Map<string, number>;
}

const SHRINK_K = 5;

export function fitCategoryMedians(rows: FitRow[]): CategoryMedianFit {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const r of rows) {
    const logMult = r.y - Math.log(Math.max(r.p.tvl_usd ?? 0, 1));
    all.push(logMult);
    const arr = byCat.get(r.p.category);
    if (arr) arr.push(logMult);
    else byCat.set(r.p.category, [logMult]);
  }
  const globalMedian = all.length > 0 ? median(all) : 0;
  const categoryLogMultiple = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const [cat, vals] of byCat) {
    const n = vals.length;
    const w = n / (n + SHRINK_K);
    categoryLogMultiple.set(cat, w * median(vals) + (1 - w) * globalMedian);
    counts.set(cat, n);
  }
  return { globalLogMultiple: globalMedian, categoryLogMultiple, counts };
}

export function categoryMedianPredict(p: SnapshotProtocol, fit: CategoryMedianFit): number {
  const logMult = fit.categoryLogMultiple.get(p.category) ?? fit.globalLogMultiple;
  const tvl = p.tvl_usd !== null && Number.isFinite(p.tvl_usd) ? Math.max(p.tvl_usd, 0) : 0;
  const v = tvl * Math.exp(logMult);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export const RIDGE_LAMBDAS = [0.01, 0.1, 1];

export interface CandidateContext {
  spec: FeatureSpec;
  /** full fit-sample rows (mcap_usd > 0) */
  rows: FitRow[];
}

export function makeCandidateContext(
  fitProtocols: SnapshotProtocol[],
  asOf: string,
): CandidateContext {
  const spec = makeFeatureSpec(fitProtocols, asOf);
  return { spec, rows: buildFitRows(fitProtocols, spec) };
}

/**
 * Fit one candidate on a set of rows. For huber-ridge the lambda is supplied
 * (chosen separately by LOO); the default is the first candidate lambda.
 */
export function fitModel(
  name: CandidateName,
  rows: FitRow[],
  ctx: CandidateContext,
  lambda = RIDGE_LAMBDAS[0],
): FittedModel {
  if (name === "size") {
    const penalty = [0, 0];
    const { beta } = fitLinear(
      rows.map((r) => ({ ...r, x: sizeVector(r.p) })),
      penalty,
      false,
    );
    const labels = ["intercept", "ln(tvl)"];
    return {
      name,
      paramCount: 2,
      coefficients: labels.map((l, i) => ({ label: l, value: beta[i] })),
      predictLog: (p) => linearPredictLog(sizeVector(p), beta),
      predict(p) {
        const v = Math.exp(this.predictLog(p));
        return Number.isFinite(v) && v > 0 ? v : 1;
      },
      receipt(p) {
        const x = sizeVector(p);
        return linearReceipt(x, beta, labels, x.slice());
      },
      meta: {},
    };
  }

  if (name === "growth-age") {
    const labels = ctx.spec.baseLabels;
    const penalty = labels.map(() => 0);
    const { beta } = fitLinear(rows, penalty, false);
    return {
      name,
      paramCount: labels.length,
      coefficients: labels.map((l, i) => ({ label: l, value: beta[i] })),
      predictLog: (p) => linearPredictLog(featureVector(p, ctx.spec), beta),
      predict(p) {
        const v = Math.exp(this.predictLog(p));
        return Number.isFinite(v) && v > 0 ? v : 1;
      },
      receipt(p) {
        const x = featureVector(p, ctx.spec).slice(0, labels.length);
        return linearReceipt(x, beta, labels, x.map((v, i) => (i === 0 ? 1 : v)));
      },
      meta: {},
    };
  }

  if (name === "huber-ridge") {
    const labels = featureLabels(ctx.spec);
    const penalty = ridgePenalties(lambda, labels, ctx.spec);
    const { beta } = fitLinear(rows, penalty, true);
    return {
      name,
      paramCount: labels.length,
      coefficients: labels.map((l, i) => ({ label: l, value: beta[i] })),
      predictLog: (p) => linearPredictLog(featureVector(p, ctx.spec), beta),
      predict(p) {
        const v = Math.exp(this.predictLog(p));
        return Number.isFinite(v) && v > 0 ? v : 1;
      },
      receipt(p) {
        const x = featureVector(p, ctx.spec);
        return linearReceipt(x, beta, labels, x.map((v, i) => (i === 0 ? 1 : v)));
      },
      meta: { lambda },
    };
  }

  // category-medians
  const fit = fitCategoryMedians(rows);
  return {
    name,
    paramCount: fit.categoryLogMultiple.size + 1,
    coefficients: [
      { label: "global log multiple", value: fit.globalLogMultiple },
      ...[...fit.categoryLogMultiple.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([cat, v]) => ({ label: `multiple:${cat}`, value: v })),
    ],
    predictLog: (p) => {
      const logMult = fit.categoryLogMultiple.get(p.category) ?? fit.globalLogMultiple;
      const tvl = p.tvl_usd !== null && Number.isFinite(p.tvl_usd) ? Math.max(p.tvl_usd, 0) : 0;
      return Math.log(Math.max(tvl, 1)) + logMult;
    },
    predict: (p) => categoryMedianPredict(p, fit),
    receipt(p) {
      const logMult = fit.categoryLogMultiple.get(p.category) ?? fit.globalLogMultiple;
      const tvl = p.tvl_usd !== null && Number.isFinite(p.tvl_usd) ? p.tvl_usd : 0;
      return [
        { label: "tvl_usd", value: tvl, coefficient: null, contribution: null },
        {
          label: `mcap/tvl multiple (${p.category})`,
          value: Math.exp(logMult),
          coefficient: null,
          contribution: null,
        },
      ];
    },
    meta: {
      globalLogMultiple: fit.globalLogMultiple,
      categories: fit.categoryLogMultiple.size,
    },
  };
}

// ---------------------------------------------------------------------------
// Exact leave-one-out scoring
// ---------------------------------------------------------------------------

export interface LooScore {
  median: number;
  p90: number;
  mean: number;
  errors: number[];
  n: number;
}

export function summarizeErrors(errors: number[]): LooScore {
  return {
    median: median(errors),
    p90: quantile(errors, 0.9),
    mean: errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0,
    errors,
    n: errors.length,
  };
}

/** Refit on all rows but i, predict row i's implied value, |log error|. */
export function looErrors(
  name: CandidateName,
  ctx: CandidateContext,
  lambda = RIDGE_LAMBDAS[0],
): number[] {
  const rows = ctx.rows;
  const errors: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.slice(0, i).concat(rows.slice(i + 1));
    if (train.length === 0) {
      errors.push(Math.abs(rows[i].y));
      continue;
    }
    const model = fitModel(name, train, ctx, lambda);
    const held = rows[i];
    const logPred = model.predictLog(held.p);
    const err = Math.abs(logPred - held.y);
    errors.push(Number.isFinite(err) ? err : 0);
  }
  return errors;
}

export interface CandidateScore {
  name: CandidateName;
  looMedian: number;
  looP90: number;
  looMean: number;
  paramCount: number;
  /** chosen ridge lambda for huber-ridge */
  lambda?: number;
  /** LOO median for every lambda tried (huber-ridge only) */
  lambdaTable?: { lambda: number; median: number; p90: number }[];
}

/** Score all four candidates; huber-ridge picks its lambda by its own LOO median. */
export function scoreCandidates(ctx: CandidateContext): CandidateScore[] {
  const results: CandidateScore[] = [];

  for (const name of CANDIDATE_ORDER) {
    if (name === "huber-ridge") {
      const table: { lambda: number; median: number; p90: number }[] = [];
      let bestLambda = RIDGE_LAMBDAS[0];
      let bestScore: LooScore | null = null;
      for (const lambda of RIDGE_LAMBDAS) {
        const score = summarizeErrors(looErrors(name, ctx, lambda));
        table.push({ lambda, median: score.median, p90: score.p90 });
        if (bestScore === null || score.median < bestScore.median) {
          bestScore = score;
          bestLambda = lambda;
        }
      }
      const model = fitModel(name, ctx.rows, ctx, bestLambda);
      results.push({
        name,
        looMedian: bestScore!.median,
        looP90: bestScore!.p90,
        looMean: bestScore!.mean,
        paramCount: model.paramCount,
        lambda: bestLambda,
        lambdaTable: table,
      });
    } else {
      const score = summarizeErrors(looErrors(name, ctx));
      const model = fitModel(name, ctx.rows, ctx);
      results.push({
        name,
        looMedian: score.median,
        looP90: score.p90,
        looMean: score.mean,
        paramCount: model.paramCount,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Winner selection and Walk-forward validation
// ---------------------------------------------------------------------------

export interface WinnerResult {
  winnerName: CandidateName;
  scores: CandidateScore;
  model: FittedModel;
}

export function selectWinner(ctx: CandidateContext): WinnerResult {
  const scores = scoreCandidates(ctx);
  scores.sort((a, b) => {
    if (Math.abs(a.looMedian - b.looMedian) > 1e-9) {
      return a.looMedian - b.looMedian;
    }
    if (Math.abs(a.looP90 - b.looP90) > 1e-9) {
      return a.looP90 - b.looP90;
    }
    return CANDIDATE_ORDER.indexOf(a.name) - CANDIDATE_ORDER.indexOf(b.name);
  });

  const best = scores[0];
  const lambda = best.name === "huber-ridge" ? best.lambda : undefined;
  const model = fitModel(best.name, ctx.rows, ctx, lambda);

  return {
    winnerName: best.name,
    scores: best,
    model,
  };
}

export interface WalkForwardResult {
  median: number;
  p90: number;
  nTrain: number;
  nTest: number;
}

export function walkForward(ctx: CandidateContext, winnerName: CandidateName): WalkForwardResult {
  const rows = [...ctx.rows].sort((a, b) => {
    const da = a.p.listed_at;
    const db = b.p.listed_at;
    if (da === null && db !== null) return -1;
    if (da !== null && db === null) return 1;
    if (da !== null && db !== null && da !== db) {
      return da < db ? -1 : 1;
    }
    return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
  });

  const splitIdx = Math.floor(rows.length * 0.6);
  const trainRows = rows.slice(0, splitIdx);
  const testRows = rows.slice(splitIdx);

  const model = fitModel(winnerName, trainRows, ctx);
  const errors: number[] = [];
  for (const row of testRows) {
    const logPred = model.predictLog(row.p);
    const err = Math.abs(logPred - row.y);
    errors.push(Number.isFinite(err) ? err : 0);
  }

  return {
    median: median(errors),
    p90: quantile(errors, 0.9),
    nTrain: trainRows.length,
    nTest: testRows.length,
  };
}

// ---------------------------------------------------------------------------
// Seeded residual bootstrap & board assembly
// ---------------------------------------------------------------------------

export function mulberry32(seed: number) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export interface BootstrapResultItem {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number | null;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  watchlist: boolean;
  implied_value_usd: number;
  implied_p10: number;
  implied_p90: number;
  rank: number;
  rank_p10: number;
  rank_p90: number;
  receipt: { label: string; value: number | string; coefficient: number; contribution: number }[];
}

export function runBootstrapAndBoard(
  snapshot: Snapshot,
  census: CensusResult,
  ctx: CandidateContext,
  winnerName: CandidateName,
  B = 200,
): BootstrapResultItem[] {
  const fitRows = ctx.rows;
  const baseModel = fitModel(winnerName, fitRows, ctx);

  const maxMcap = Math.max(...fitRows.map(r => Math.exp(r.y)));
  const clampLo = 100000;
  const clampHi = 2 * maxMcap;

  const fittedLogs = fitRows.map(r => baseModel.predictLog(r.p));
  const residuals = fitRows.map((r, i) => r.y - fittedLogs[i]);

  const preTokenEntries = census.entries.filter(e => e.cls === "PRE_TOKEN");
  const preTokenProtocols = preTokenEntries
    .map(e => snapshot.protocols.find(p => p.slug === e.slug)!)
    .filter(Boolean);

  preTokenProtocols.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  const rng = mulberry32(0x5EED);
  const rankRng = mulberry32(0x789A);

  const bootImplieds: Record<string, number[]> = {};
  const bootRanks: Record<string, number[]> = {};
  for (const p of preTokenProtocols) {
    bootImplieds[p.slug] = [];
    bootRanks[p.slug] = [];
  }

  for (let b = 0; b < B; b++) {
    const starRows = fitRows.map((r, i) => {
      const idx = Math.floor(rng() * residuals.length);
      const resampledResid = residuals[idx];
      const yStar = fittedLogs[i] + resampledResid;
      return { ...r, y: yStar };
    });

    const starModel = fitModel(winnerName, starRows, ctx);

    const rawList: { p: SnapshotProtocol; rawImplied: number }[] = [];
    for (const p of preTokenProtocols) {
      const logPred = starModel.predictLog(p);
      let raw = Math.exp(logPred);
      if (!Number.isFinite(raw)) raw = clampLo;
      raw = Math.max(clampLo, Math.min(clampHi, raw));
      rawList.push({ p, rawImplied: raw });
    }

    const rankList: { p: SnapshotProtocol; rawImplied: number }[] = [];
    for (const p of preTokenProtocols) {
      const noise = residuals[Math.floor(rankRng() * residuals.length)];
      const logPred = starModel.predictLog(p) + noise;
      let raw = Math.exp(logPred);
      if (!Number.isFinite(raw)) raw = clampLo;
      raw = Math.max(clampLo, Math.min(clampHi, raw));
      rankList.push({ p, rawImplied: raw });
    }

    rawList.sort((x, y) => {
      if (Math.abs(y.rawImplied - x.rawImplied) > 1e-9) {
        return y.rawImplied - x.rawImplied;
      }
      return x.p.slug < y.p.slug ? -1 : x.p.slug > y.p.slug ? 1 : 0;
    });

    let cumMin = Infinity;
    const processed: { slug: string; implied: number; rank: number }[] = [];
    for (let i = 0; i < rawList.length; i++) {
      cumMin = Math.min(cumMin, rawList[i].rawImplied);
      const rounded = Math.round(cumMin);
      processed.push({
        slug: rawList[i].p.slug,
        implied: rounded,
        rank: i + 1,
      });
    }

    rankList.sort((x, y) => {
      if (Math.abs(y.rawImplied - x.rawImplied) > 1e-9) {
        return y.rawImplied - x.rawImplied;
      }
      return x.p.slug < y.p.slug ? -1 : x.p.slug > y.p.slug ? 1 : 0;
    });

    for (let i = 0; i < processed.length; i++) {
      bootImplieds[processed[i].slug].push(processed[i].implied);
      bootRanks[rankList[i].p.slug].push(i + 1);
    }
  }

  const baseRawList: { p: SnapshotProtocol; rawImplied: number }[] = [];
  for (const p of preTokenProtocols) {
    const logPred = baseModel.predictLog(p);
    let raw = Math.exp(logPred);
    if (!Number.isFinite(raw)) raw = clampLo;
    raw = Math.max(clampLo, Math.min(clampHi, raw));
    baseRawList.push({ p, rawImplied: raw });
  }

  baseRawList.sort((x, y) => {
    if (Math.abs(y.rawImplied - x.rawImplied) > 1e-9) {
      return y.rawImplied - x.rawImplied;
    }
    return x.p.slug < y.p.slug ? -1 : x.p.slug > y.p.slug ? 1 : 0;
  });

  let cumMinBase = Infinity;
  const boardRows: BootstrapResultItem[] = [];
  for (let i = 0; i < baseRawList.length; i++) {
    const item = baseRawList[i];
    cumMinBase = Math.min(cumMinBase, item.rawImplied);
    const impliedUsd = Math.round(cumMinBase);
    const rank = i + 1;

    const impliedVals = bootImplieds[item.p.slug].sort((a, b) => a - b);
    const rankVals = bootRanks[item.p.slug].sort((a, b) => a - b);

    const implied_p10 = quantile(impliedVals, 0.1);
    const implied_p90 = quantile(impliedVals, 0.9);
    let rank_p10 = clamp(Math.round(quantile(rankVals, 0.1)), 1, 198);
    let rank_p90 = clamp(Math.round(quantile(rankVals, 0.9)), 1, 198);
    if (rank_p10 > rank_p90) rank_p90 = rank_p10;

    const receipt = baseModel.receipt(item.p);
    const ageDays = ageYears(item.p, snapshot.as_of);
    const age_days = ageDays !== null ? Math.round(ageDays * 365.25) : null;
    const watchlist = snapshot.watchlist.includes(item.p.slug);

    boardRows.push({
      slug: item.p.slug,
      name: item.p.name,
      category: item.p.category,
      chains: item.p.chains,
      tvl_usd: item.p.tvl_usd,
      change_7d: item.p.change_7d,
      age_days,
      listed_at: item.p.listed_at,
      watchlist,
      implied_value_usd: impliedUsd,
      implied_p10,
      implied_p90,
      rank,
      rank_p10,
      rank_p90,
      receipt,
    });
  }

  return boardRows;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number | null;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  watchlist: boolean;
  implied_value_usd: number;
  implied_mcap_usd: number;
  range_low_usd: number;
  range_high_usd: number;
  rank_p10: number;
  rank_p90: number;
  upside_x: number | null;
  confidence: number;
  evidence: string;
  receipt: { label: string; value: number | string; coefficient: number; contribution: number }[];
}

export function assembleBoard(
  snapshot: Snapshot,
  census: CensusResult,
  ctx: CandidateContext,
  winnerName: CandidateName,
  B = 200,
): BoardRow[] {
  const rawItems = runBootstrapAndBoard(snapshot, census, ctx, winnerName, B);
  return rawItems.map(item => {
    const implied_mcap_usd = item.implied_value_usd;
    const range_low_usd = item.implied_p10;
    const range_high_usd = item.implied_p90;
    const tvl = item.tvl_usd;
    const upside_x = tvl !== null && tvl > 0 ? Number((implied_mcap_usd / tvl).toFixed(2)) : null;
    const span = range_high_usd - range_low_usd;
    const confidence = Math.max(0.1, Math.min(1.0, Number((1 - span / (implied_mcap_usd + span)).toFixed(2))));
    const evidence = `Implied valuation $${implied_mcap_usd.toLocaleString()} via ${winnerName} model (TVL $${tvl ?? 0})`;

    return {
      ...item,
      implied_mcap_usd,
      range_low_usd,
      range_high_usd,
      upside_x,
      confidence,
      evidence,
    };
  });
}

export function runSelfChecks(boardRows: BoardRow[], census: CensusResult, snapshot: Snapshot): void {
  const expectedCount = census.counts.PRE_TOKEN;
  if (boardRows.length !== expectedCount) {
    throw new Error(`Self-check failed: board row count ${boardRows.length} does not match PRE_TOKEN census count ${expectedCount}`);
  }

  const slugs = new Set<string>();
  let prevImplied = Infinity;
  let allEqual = true;
  const firstImplied = boardRows[0]?.implied_mcap_usd;

  for (let i = 0; i < boardRows.length; i++) {
    const r = boardRows[i];
    if (r.rank !== i + 1) {
      throw new Error(`Self-check failed: row at index ${i} has rank ${r.rank}, expected ${i + 1}`);
    }
    if (slugs.has(r.slug)) {
      throw new Error(`Self-check failed: duplicate slug ${r.slug}`);
    }
    slugs.add(r.slug);

    if (!snapshot.protocols.some(p => p.slug === r.slug)) {
      throw new Error(`Self-check failed: slug ${r.slug} is not in snapshot protocols`);
    }

    const fieldsToCheck = [
      r.rank, r.tvl_usd, r.change_7d, r.age_days, r.implied_value_usd,
      r.implied_mcap_usd, r.range_low_usd, r.range_high_usd, r.rank_p10, r.rank_p90,
      r.upside_x, r.confidence
    ];
    for (const v of fieldsToCheck) {
      if (v !== null && !Number.isFinite(v)) {
        throw new Error(`Self-check failed: non-finite value for slug ${r.slug}`);
      }
    }

    if (r.implied_mcap_usd <= 0) {
      throw new Error(`Self-check failed: non-positive implied mcap for slug ${r.slug}`);
    }

    if (!(r.range_low_usd <= r.implied_mcap_usd && r.implied_mcap_usd <= r.range_high_usd)) {
      if (r.range_low_usd > r.range_high_usd) {
        throw new Error(`Self-check failed: band ordered incorrectly for slug ${r.slug}`);
      }
    }

    if (r.implied_mcap_usd > prevImplied + 1e-9) {
      throw new Error(`Self-check failed: implied values rising with rank for slug ${r.slug}`);
    }
    prevImplied = r.implied_mcap_usd;

    if (r.implied_mcap_usd !== firstImplied) {
      allEqual = false;
    }
  }

  if (allEqual && boardRows.length > 1) {
    throw new Error(`Self-check failed: all implied values are equal`);
  }

  for (const wSlug of snapshot.watchlist) {
    if (!boardRows.some(r => r.slug === wSlug)) {
      throw new Error(`Self-check failed: watchlist slug ${wSlug} missing from board`);
    }
  }
}

export function buildDashboardData(
  snapshot: Snapshot,
  census: CensusResult,
  ctx: CandidateContext,
  winnerResult: WinnerResult,
  wfResult: WalkForwardResult,
  boardRows: BoardRow[],
  candidateScores: CandidateScore[],
) {
  const categoriesMap: Record<string, { count: number; total_tvl: number }> = {};
  for (const p of snapshot.protocols) {
    const cat = p.category;
    if (!categoriesMap[cat]) {
      categoriesMap[cat] = { count: 0, total_tvl: 0 };
    }
    categoriesMap[cat].count++;
    if (p.tvl_usd !== null && Number.isFinite(p.tvl_usd)) {
      categoriesMap[cat].total_tvl += p.tvl_usd;
    }
  }

  return {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
    },
    census: {
      counts: census.counts,
    },
    method: {
      winner: winnerResult.winnerName,
      candidates: candidateScores.map(c => ({
        name: c.name,
        loo_median: c.looMedian,
        loo_p90: c.looP90,
        n_params: c.paramCount,
      })),
      walk_forward: {
        median: wfResult.median,
        p90: wfResult.p90,
        n_train: wfResult.nTrain,
        n_test: wfResult.nTest,
      },
    },
    board: boardRows,
    categories: categoriesMap,
    ledger: census.entries.map(e => ({
      slug: e.slug,
      name: e.name,
      class: e.cls,
      reason: e.reason,
    })),
  };
}
