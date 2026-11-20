[![Badge 1](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![Badge 2](https://make.fun/badge/token-radar-01/arrijalu/token-launch-radar/rank.svg)](https://make.fun/c/token-radar-01)
[![Badge 3](https://make.fun/badge/token-radar-01/arrijalu/token-launch-radar/reward.svg)](https://make.fun/c/token-radar-01)

# Token Launch Radar (token-radar-01)

## What This Is
Token Launch Radar is a pre-token launch valuation and risk analysis system built for the `make.fun` competition (`token-radar-01`). It evaluates protocol metrics from a sealed market snapshot to project implied market capitalization, rank uncertainty bands, and actionable yield/farming strategies for pre-token protocols.

## How It Works
1. **Census Cascade**: Parses and validates snapshot data through a six-step pipeline, categorizing protocols and populating a per-protocol ledger.
2. **Model Selection**: Evaluates four candidate regression models (Size Model, Growth-Age Model, Huber Ridge, and Category Medians) using Leave-One-Out (LOO) cross-validation. The **Size Model** won with a LOO median error of **1.223**.
3. **Walk-Forward Validation**: Assesses out-of-sample predictive performance over chronological splits (test median 1.047).
4. **Seeded Bootstrap & Rank Ranges**: Applies a B=200 seeded residual bootstrap with mulberry32 (seed `0x5EED`) to generate robust implied market cap p10/p90 bands and rank uncertainty ranges.
5. **Farm Engine**: Calculates gas costs, deposit tiers, expected shares, and net EV across protocol categories to classify every protocol into **FARM**, **THIN**, or **SKIP** verdicts.

## How To Run
Execute the main pipeline script with Node.js, specifying an output directory:
```bash
node main.ts output
```

## Headline Verified Numbers
- **Winning Model**: Size Model
- **LOO Median Error**: 1.223 (p90 3.426)
- **Walk-Forward Test Median**: 1.047 (p90 3.223)
- **Board Size**: 198 protocols (ordered by implied market capitalization descending)
- **Watchlist**: 40/40 pre-token protocols successfully tracked
- **Verdict Mix**: FARM 25 / THIN 168 / SKIP 5

## Dashboard
The dashboard provides an interactive dark-themed interface with hash routing (`#/` for the board, `#/p/<slug>` for protocol details, and `#/method` for census, model comparison, and ledger data). It fully serializes the computed data bundle into `window.RADAR`.

## Limitations
Valuations and rank projections are statistical estimates derived from historical TVL relationships and sealed snapshot features. Actual token launch market performance may vary due to changing macroeconomic conditions, liquidity shifts, and tokenomics structures.
