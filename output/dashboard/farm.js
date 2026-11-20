// dashboard/farm.js — the single source of truth for farm plans.
//
// The Node program (main.ts) imports this module to fill every board row's
// farm_steps, and the dashboard page loads the very same file to render the
// plan in the detail view, so the board file and the page can never disagree.
//
// Plain ES module JavaScript: no TypeScript syntax, no imports of its own, no
// Node-only APIs, so it runs identically under Node 22 and in a browser.

// ---------------------------------------------------------------------------
// Gas: per-chain [simple transaction USD, complex transaction USD]
// ---------------------------------------------------------------------------

export const GAS_TABLE = {
  Ethereum: [6, 18],
  Arbitrum: [0.15, 0.15],
  Binance: [0.2, 0.2],
  Base: [0.15, 0.15],
  Solana: [0.01, 0.01],
  Avalanche: [0.3, 0.3],
  Polygon: [0.05, 0.05],
  Optimism: [0.15, 0.15],
};

/** Any chain not named above costs as this pair. */
export const DEFAULT_GAS = [0.5, 1.5];

// ---------------------------------------------------------------------------
// The stated persona and every netting constant, as data
// ---------------------------------------------------------------------------

export const ASSUMPTIONS = {
  /** The horizon a plan is priced over, in days. */
  horizon_days: 90,
  /** Deposit per protocol by TVL tier: [tvl_at_least_usd, deposit_usd]. */
  deposit_tiers: [
    [1e9, 2000],
    [1e8, 1000],
    [1e7, 500],
    [1e6, 250],
    [0, 100],
  ],
  /** The farmer pool for a protocol is this fraction of its implied value. */
  pool_fraction: 0.1,
  /** Competing farmer capital is this fraction of the protocol's TVL. */
  competitor_fraction: 0.1,
  /** The farmer's share of the pool is capped here. */
  share_cap: 0.002,
  /** Expected value is the implied value times this fraction times the share. */
  ev_fraction: 0.1,
  /** Opportunity cost: the deposit earns this APY elsewhere over the horizon. */
  apy: 0.05,
  /** Active time is priced at this wage per hour. */
  wage_per_hour: 20,
  /** FARM needs at least this net. */
  farm_min_net_usd: 150,
  /** FARM needs net / cost at least this ratio. */
  farm_min_net_over_cost: 1.5,
  notes: [
    "The reference farmer commits a fixed deposit per protocol by TVL tier over a 90-day horizon.",
    "Farmer pool = 10% of the protocol's implied value; competing capital = 10% of its TVL.",
    "Share = min(deposit / (10% of TVL), 0.2%); EV = implied value x 10% x share.",
    "Costs = gas over the plan's transactions at the cheapest listed chain's rates, plus the deposit's opportunity cost at 5% APY for 90/365, plus active minutes at $20/hour.",
    "net = EV - costs. FARM when net >= $150 and net/cost >= 1.5; THIN when net > 0; SKIP otherwise.",
  ],
};

// ---------------------------------------------------------------------------
// Small deterministic formatters (no locale APIs)
// ---------------------------------------------------------------------------

/** Whole-dollar text with thousands commas: 2000 -> "$2,000". */
export function usd(n) {
  const neg = n < 0;
  const whole = Math.round(Math.abs(n));
  let s = String(whole);
  let out = "";
  while (s.length > 3) {
    out = "," + s.slice(-3) + out;
    s = s.slice(0, -3);
  }
  return (neg ? "-$" : "$") + s + out;
}

/** Gas text: at least two decimals below $100, whole dollars from $100 up. */
export function gasText(n) {
  if (n >= 100) return usd(n);
  const cents = Math.round(n * 100);
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  if (frac === "00") return "$" + whole;
  return "$" + whole + "." + frac;
}

/** Cents, for arithmetic fields written into JSON. */
function cents(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Tiers, chains, gas
// ---------------------------------------------------------------------------

/** Deposit for a protocol by its TVL tier. */
export function depositFor(tvlUsd) {
  const tvl = typeof tvlUsd === "number" && Number.isFinite(tvlUsd) ? tvlUsd : 0;
  for (const [floor, dep] of ASSUMPTIONS.deposit_tiers) {
    if (tvl >= floor) return dep;
  }
  return ASSUMPTIONS.deposit_tiers[ASSUMPTIONS.deposit_tiers.length - 1][1];
}

/** Rates for one chain name. */
export function gasRates(chain) {
  return GAS_TABLE[chain] || DEFAULT_GAS;
}

/** The cheapest listed chain: the one minimizing simple + complex gas. */
export function cheapestChain(chains) {
  const list = Array.isArray(chains) ? chains.filter((c) => typeof c === "string" && c.length > 0) : [];
  if (list.length === 0) return "Ethereum";
  let best = list[0];
  let bestCost = Infinity;
  for (const c of list) {
    const [s, x] = gasRates(c);
    const cost = s + x;
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Category playbooks: concise per-category playbooks from brief-02-farm.md
// ---------------------------------------------------------------------------

const PLAYBOOKS = {
  Dexs: {
    main: "Provide liquidity of {dep} to {name}'s pool on {chain}, adding both sides to target gross {gross}, gas {gas}, net {net}.",
    second: "Make one swap through {name} on {chain} weekly alongside deposit {dep} to target gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "Liquidity Manager": {
    main: "Provide liquidity of {dep} to {name}'s pool on {chain}, adding both sides to target gross {gross}, gas {gas}, net {net}.",
    second: "Make one swap through {name} on {chain} weekly alongside deposit {dep} to target gross {gross}, net {net}.",
    tx: [1, 1],
  },
  Lending: {
    main: "Supply {dep} collateral to {name} on {chain}, borrow stablecoin with 150% buffer to target gross {gross}, gas {gas}, net {net}.",
    second: "Loop or farm incentive tokens on {name} ({chain}), monitoring liquidation health to target gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Uncollateralized Lending": {
    main: "Supply {dep} collateral to {name} on {chain}, borrow stablecoin with 150% buffer to target gross {gross}, gas {gas}, net {net}.",
    second: "Loop or farm incentive tokens on {name} ({chain}), monitoring liquidation health to target gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Collateral Markets": {
    main: "Supply {dep} collateral to {name} on {chain}, borrow stablecoin with 150% buffer to target gross {gross}, gas {gas}, net {net}.",
    second: "Loop or farm incentive tokens on {name} ({chain}), monitoring liquidation health to target gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Collateral Management": {
    main: "Supply {dep} collateral to {name} on {chain}, borrow stablecoin with 150% buffer to target gross {gross}, gas {gas}, net {net}.",
    second: "Loop or farm incentive tokens on {name} ({chain}), monitoring liquidation health to target gross {gross}, net {net}.",
    tx: [0, 1],
  },
  Derivatives: {
    main: "Deposit {dep} margin at {name} on {chain}, place maker orders and capture funding for gross {gross}, gas {gas}, net {net}.",
    second: "Roll or adjust hedge at {name} on {chain} once, keeping position market-neutral for gross {gross}, net {net}.",
    tx: [0, 1],
  },
  Options: {
    main: "Deposit {dep} margin at {name} on {chain}, place maker orders and capture funding for gross {gross}, gas {gas}, net {net}.",
    second: "Roll or adjust hedge at {name} on {chain} once, keeping position market-neutral for gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Interest Rate Derivatives": {
    main: "Deposit {dep} margin at {name} on {chain}, place maker orders and capture funding for gross {gross}, gas {gas}, net {net}.",
    second: "Roll or adjust hedge at {name} on {chain} once, keeping position market-neutral for gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Options Vault": {
    main: "Deposit {dep} margin at {name} on {chain}, place maker orders and capture funding for gross {gross}, gas {gas}, net {net}.",
    second: "Roll or adjust hedge at {name} on {chain} once, keeping position market-neutral for gross {gross}, net {net}.",
    tx: [0, 1],
  },
  Synthetics: {
    main: "Deposit {dep} margin at {name} on {chain}, place maker orders and capture funding for gross {gross}, gas {gas}, net {net}.",
    second: "Roll or adjust hedge at {name} on {chain} once, keeping position market-neutral for gross {gross}, net {net}.",
    tx: [0, 1],
  },
  CDP: {
    main: "Deposit {dep} collateral into {name} on {chain}, mint stablecoins below max ratio for gross {gross}, gas {gas}, net {net}.",
    second: "Hold minted stablecoins or provide liquidity on {name} ({chain}) to secure gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "CDP Manager": {
    main: "Deposit {dep} collateral into {name} on {chain}, mint stablecoins below max ratio for gross {gross}, gas {gas}, net {net}.",
    second: "Hold minted stablecoins or provide liquidity on {name} ({chain}) to secure gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "Dual-Token Stablecoin": {
    main: "Deposit {dep} collateral into {name} on {chain}, mint stablecoins below max ratio for gross {gross}, gas {gas}, net {net}.",
    second: "Hold minted stablecoins or provide liquidity on {name} ({chain}) to secure gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "Stablecoin Issuer": {
    main: "Deposit {dep} collateral into {name} on {chain}, mint stablecoins below max ratio for gross {gross}, gas {gas}, net {net}.",
    second: "Hold minted stablecoins or provide liquidity on {name} ({chain}) to secure gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "Stablecoin Wrapper": {
    main: "Deposit {dep} collateral into {name} on {chain}, mint stablecoins below max ratio for gross {gross}, gas {gas}, net {net}.",
    second: "Hold minted stablecoins or provide liquidity on {name} ({chain}) to secure gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "Algo-Stables": {
    main: "Deposit {dep} collateral into {name} on {chain}, mint stablecoins below max ratio for gross {gross}, gas {gas}, net {net}.",
    second: "Hold minted stablecoins or provide liquidity on {name} ({chain}) to secure gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "Reserve Currency": {
    main: "Deposit {dep} collateral into {name} on {chain}, mint stablecoins below max ratio for gross {gross}, gas {gas}, net {net}.",
    second: "Hold minted stablecoins or provide liquidity on {name} ({chain}) to secure gross {gross}, net {net}.",
    tx: [1, 1],
  },
  Yield: {
    main: "Deposit {dep} into {name} vault on {chain}, confirm terms to target gross {gross}, gas {gas}, net {net}.",
    second: "Enable compounding or move to boosted tier on {name} ({chain}) for gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "Yield Aggregator": {
    main: "Deposit {dep} into {name} vault on {chain}, confirm terms to target gross {gross}, gas {gas}, net {net}.",
    second: "Enable compounding or move to boosted tier on {name} ({chain}) for gross {gross}, net {net}.",
    tx: [1, 1],
  },
  Farm: {
    main: "Deposit {dep} into {name} vault on {chain}, confirm terms to target gross {gross}, gas {gas}, net {net}.",
    second: "Enable compounding or move to boosted tier on {name} ({chain}) for gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "Leveraged Farming": {
    main: "Deposit {dep} into {name} vault on {chain}, confirm terms to target gross {gross}, gas {gas}, net {net}.",
    second: "Enable compounding or move to boosted tier on {name} ({chain}) for gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "Risk Curators": {
    main: "Deposit {dep} into {name} curated vault on {chain}, check strategy for gross {gross}, gas {gas}, net {net}.",
    second: "Set notification/rebalance preferences at {name} ({chain}) for gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "Onchain Capital Allocator": {
    main: "Deposit {dep} into {name} curated vault on {chain}, check strategy for gross {gross}, gas {gas}, net {net}.",
    second: "Set notification/rebalance preferences at {name} ({chain}) for gross {gross}, net {net}.",
    tx: [1, 1],
  },
  RWA: {
    main: "Mint or buy tokenized asset {name} on {chain} with {dep} for gross {gross}, gas {gas}, net {net}.",
    second: "Hold position and collect distribution on {name} ({chain}) for gross {gross}, net {net}.",
    tx: [0, 1],
  },
  Indexes: {
    main: "Mint or buy tokenized asset {name} on {chain} with {dep} for gross {gross}, gas {gas}, net {net}.",
    second: "Hold position and collect distribution on {name} ({chain}) for gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Liquid Staking": {
    main: "Stake native asset with {name} on {chain} using {dep}, keep LST receipt for gross {gross}, gas {gas}, net {net}.",
    second: "Restake or lend {name} receipt token on {chain} for secondary yield, gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Staking Pool": {
    main: "Stake native asset with {name} on {chain} using {dep}, keep LST receipt for gross {gross}, gas {gas}, net {net}.",
    second: "Restake or lend {name} receipt token on {chain} for secondary yield, gross {gross}, net {net}.",
    tx: [0, 1],
  },
  Restaking: {
    main: "Stake native asset with {name} on {chain} using {dep}, keep LST receipt for gross {gross}, gas {gas}, net {net}.",
    second: "Restake or lend {name} receipt token on {chain} for secondary yield, gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Liquid Restaking": {
    main: "Stake native asset with {name} on {chain} using {dep}, keep LST receipt for gross {gross}, gas {gas}, net {net}.",
    second: "Restake or lend {name} receipt token on {chain} for secondary yield, gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Restaked BTC": {
    main: "Stake native asset with {name} on {chain} using {dep}, keep LST receipt for gross {gross}, gas {gas}, net {net}.",
    second: "Restake or lend {name} receipt token on {chain} for secondary yield, gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Decentralized BTC": {
    main: "Stake native asset with {name} on {chain} using {dep}, keep LST receipt for gross {gross}, gas {gas}, net {net}.",
    second: "Restake or lend {name} receipt token on {chain} for secondary yield, gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Anchor BTC": {
    main: "Stake native asset with {name} on {chain} using {dep}, keep LST receipt for gross {gross}, gas {gas}, net {net}.",
    second: "Restake or lend {name} receipt token on {chain} for secondary yield, gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Basis Trading": {
    main: "Deposit {dep} margin for {name} basis position on {chain} for gross {gross}, gas {gas}, net {net}.",
    second: "Rebalance hedge leg at {name} on {chain} once to keep spot/perp matched, gross {gross}, net {net}.",
    tx: [0, 1],
  },
  CeDeFi: {
    main: "Deposit {dep} margin for {name} basis position on {chain} for gross {gross}, gas {gas}, net {net}.",
    second: "Rebalance hedge leg at {name} on {chain} once to keep spot/perp matched, gross {gross}, net {net}.",
    tx: [0, 1],
  },
  "Prediction Market": {
    main: "Fund {name} account on {chain} with {dep}, take position on event for gross {gross}, gas {gas}, net {net}.",
    second: "Add to position or settle resolved {name} market on {chain} for gross {gross}, net {net}.",
    tx: [1, 1],
  },
  Chain: {
    main: "Bridge {dep} to {chain} via {name}, use native app for gross {gross}, gas {gas}, net {net}.",
    second: "Transact in second native app on {name} ({chain}) for gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "Cross Chain Bridge": {
    main: "Bridge {dep} to {chain} via {name}, use native app for gross {gross}, gas {gas}, net {net}.",
    second: "Transact in second native app on {name} ({chain}) for gross {gross}, net {net}.",
    tx: [1, 1],
  },
  "Canonical Bridge": {
    main: "Bridge {dep} to {chain} via {name}, use native app for gross {gross}, gas {gas}, net {net}.",
    second: "Transact in second native app on {name} ({chain}) for gross {gross}, net {net}.",
    tx: [1, 1],
  },
  Bridge: {
    main: "Bridge {dep} to {chain} via {name}, use native app for gross {gross}, gas {gas}, net {net}.",
    second: "Transact in second native app on {name} ({chain}) for gross {gross}, net {net}.",
    tx: [1, 1],
  },
  Launchpad: {
    main: "Deposit {dep} into {name} on {chain} for token allocation tier, gross {gross}, gas {gas}, net {net}.",
    second: "Claim allocated tokens from {name} ({chain}), setup vesting for gross {gross}, net {net}.",
    tx: [1, 1],
  },
};

const DEFAULT_PLAYBOOK = {
  main: "Deposit {dep} into {name} main product on {chain} for gross {gross}, gas {gas}, net {net}.",
  second: "Make further qualifying interaction with {name} ({chain}) for gross {gross}, net {net}.",
  tx: [0, 1],
};

/** The playbook for a category string. */
export function playbookFor(category) {
  const key = typeof category === "string" ? category : "";
  return PLAYBOOKS[key] || DEFAULT_PLAYBOOK;
}

function fill(template, name, chain, dep, gross, gas, net) {
  return template
    .split("{name}").join(name)
    .split("{chain}").join(chain)
    .split("{dep}").join(dep)
    .split("{gross}").join(gross)
    .split("{gas}").join(gas)
    .split("{net}").join(net);
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/** FARM / THIN / SKIP for a net and a total cost. */
export function verdictFor(net, cost) {
  if (net >= ASSUMPTIONS.farm_min_net_usd && cost > 0 && net / cost >= ASSUMPTIONS.farm_min_net_over_cost) {
    return "FARM";
  }
  if (net > 0) return "THIN";
  return "SKIP";
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * planFor(row) — row is {slug, name, category, chains, tvl_usd,
 * implied_value_usd}. Returns the six steps (each with text, cost, time
 * display strings), the deposit, and the full verdict arithmetic.
 */
export function planFor(row) {
  const r = row || {};
  const name = typeof r.name === "string" && r.name.length > 0 ? r.name : "the protocol";
  const category = typeof r.category === "string" ? r.category : "";
  const chains = Array.isArray(r.chains) ? r.chains : [];
  const chain = cheapestChain(chains);
  const [simpleRate, complexRate] = gasRates(chain);
  const tvl = typeof r.tvl_usd === "number" && Number.isFinite(r.tvl_usd) ? r.tvl_usd : 0;
  const implied = typeof r.implied_value_usd === "number" && Number.isFinite(r.implied_value_usd) ? r.implied_value_usd : 0;

  const deposit = depositFor(tvl);
  const dep = usd(deposit);
  const play = playbookFor(category);
  const [mainSimple, mainComplex] = play.tx;

  const poolUsd = implied * ASSUMPTIONS.pool_fraction;
  const competing = tvl * ASSUMPTIONS.competitor_fraction;
  const share = competing > 0 ? Math.min(deposit / competing, ASSUMPTIONS.share_cap) : ASSUMPTIONS.share_cap;
  const evUsd = implied * ASSUMPTIONS.ev_fraction * share;
  const oppUsd = deposit * ASSUMPTIONS.apy * (ASSUMPTIONS.horizon_days / 365);

  // Declared transactions and active minutes per step.
  const shape = [
    { simple: 0, complex: 0, minutes: 10 }, // 1 set up
    { simple: mainSimple, complex: mainComplex, minutes: 15 }, // 2 main action
    { simple: 1, complex: 0, minutes: 10 }, // 3 second action
    { simple: 6, complex: 0, minutes: 30 }, // 4 stay active
    { simple: 0, complex: 0, minutes: 10 }, // 5 points and claim check
    { simple: 0, complex: 1, minutes: 15 }, // 6 exit and log
  ];
  const stepGas = shape.map((s) => s.simple * simpleRate + s.complex * complexRate);
  const totalGas = stepGas.reduce((a, b) => a + b, 0);
  const totalMinutes = shape.reduce((a, s) => a + s.minutes, 0);

  const gross = usd(cents(evUsd));
  const gasStr = gasText(totalGas);
  const timeUsd = (totalMinutes / 60) * ASSUMPTIONS.wage_per_hour;
  const costUsd = totalGas + oppUsd + timeUsd;
  const netUsd = evUsd - costUsd;
  const net = usd(cents(netUsd));

  const minutes = (m) => m + (m === 1 ? " minute" : " minutes");
  const gasLine = (g) => (g > 0 ? "about " + gasText(g) + " of gas on " + chain : "no transaction, so no gas");

  const steps = [
    {
      text: fill("Create wallet for {name} on {chain}, fund {dep} + {gas} gas, seed offline. Target gross {gross}, net {net}.", name, chain, dep, gross, gasStr, net),
      cost: "the " + dep + " stays in the position, plus " + gasText(totalGas) + " for gas",
      time: minutes(shape[0].minutes),
    },
    {
      text: fill(play.main, name, chain, dep, gross, gasStr, net),
      cost: gasLine(stepGas[1]),
      time: minutes(shape[1].minutes),
    },
    {
      text: fill(play.second, name, chain, dep, gross, gasStr, net),
      cost: gasLine(stepGas[2]),
      time: minutes(shape[2].minutes),
    },
    {
      text: fill("Stay active with {name} ({chain}): weekly actions & monthly check-in with {dep}. Target gross {gross}, net {net}.", name, chain, dep, gross, gasStr, net),
      cost: gasLine(stepGas[3]),
      time: minutes(shape[3].minutes),
    },
    {
      text: fill("Check {name} rewards page directly, claim via official links. Verify gross {gross}, net {net}.", name, chain, dep, gross, gasStr, net),
      cost: "no transaction, so no gas",
      time: minutes(shape[4].minutes),
    },
    {
      text: fill("Withdraw from {name} on {chain} at horizon end, log transactions securing deposit {dep}, gross {gross}, net {net}.", name, chain, dep, gross, gasStr, net),
      cost: gasLine(stepGas[5]),
      time: minutes(shape[5].minutes),
    },
  ];

  return {
    steps,
    deposit,
    ev_usd: cents(evUsd),
    gas_usd: cents(totalGas),
    opp_usd: cents(oppUsd),
    time_usd: cents(timeUsd),
    cost_usd: cents(costUsd),
    net_usd: cents(netUsd),
    verdict: verdictFor(netUsd, costUsd),
    // context kept for the caller's convenience
    pool_usd: cents(poolUsd),
    share,
    chain,
    active_minutes: totalMinutes,
    simple_txs: shape.reduce((a, s) => a + s.simple, 0),
    complex_txs: shape.reduce((a, s) => a + s.complex, 0),
  };
}

/** One board/dashboard step string: text, cost and time in one sentence. */
export function composeStep(step) {
  return step.text + " Cost: " + step.cost + ". Time: " + step.time + ".";
}

/**
 * computeFarmPlan(protocol, context) — the compact public shape:
 * {verdict, deposit_usd, expected_net_usd, steps} where steps are the
 * composed strings, 3 to 12 of them, each 20 to 600 characters.
 */
export function computeFarmPlan(protocol, context) {
  const plan = planFor(protocol);
  const steps = plan.steps.map(composeStep);
  return {
    verdict: plan.verdict,
    deposit_usd: plan.deposit,
    expected_net_usd: plan.net_usd,
    steps,
  };
}
