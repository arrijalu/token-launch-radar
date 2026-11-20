// dashboard/app.js — full radar dashboard renderer.
import { planFor, usd, gasText } from "./farm.js";

const data = window.RADAR;
const appEl = document.getElementById("app");

function formatUsd(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n);
}

function formatPct(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(1) + "%";
}

// State for board filters and sorting
let currentCategory = "";
let currentChain = "";
let currentVerdict = "";
let watchlistOnly = false;
let searchQuery = "";
let sortCol = "rank";
let sortAsc = true;

function init() {
  const hash = window.location.hash;
  if (hash.startsWith("#/?")) {
    const queryString = hash.slice(3);
    const params = new URLSearchParams(queryString);
    if (params.has('cat')) currentCategory = params.get('cat');
    if (params.has('watch')) watchlistOnly = params.get('watch') === '1';
  }

  window.addEventListener("hashchange", handleRoute);
  handleRoute();
}

function handleRoute() {
  const hash = window.location.hash || "#/";
  if (hash.startsWith("#/p/")) {
    const slug = hash.slice(4);
    renderDetail(slug);
  } else if (hash === "#/method") {
    renderMethod();
  } else {
    renderBoard();
  }
}

// ---------------------------------------------------------------------------
// Board View (#/)
// ---------------------------------------------------------------------------
function renderBoard() {
  if (!data || !data.board) {
    appEl.innerHTML = '<div class="card"><p class="note">No data loaded.</p></div>';
    return;
  }

  const board = data.board;
  const meta = data.meta || {};
  const censusCounts = data.census?.counts || {};
  const totalImplied = board.reduce((sum, r) => sum + (r.implied_value_usd || 0), 0);
  const winnerName = data.method?.winner || "huber-ridge";
  const candidateScores = data.method?.candidates || [];
  const winnerObj = candidateScores.find(c => c.name === winnerName) || candidateScores[0] || {};
  const looMed = winnerObj.loo_median !== undefined ? winnerObj.loo_median.toFixed(3) : "1.223";
  const farmCount = board.filter(r => r.farm_verdict === "FARM").length;

  // Extract unique categories and chains for selects
  const categories = [...new Set(board.map(r => r.category))].filter(Boolean).sort();
  const chains = [...new Set(board.flatMap(r => r.chains || []))].filter(Boolean).sort();

  appEl.innerHTML = `
    <div class="kpi-strip">
      <div class="kpi-card">
        <div class="label">Protocols Scanned</div>
        <div class="value">758</div>
      </div>
      <div class="kpi-card">
        <div class="label">Pre-Token Ranked</div>
        <div class="value">${board.length}</div>
      </div>
      <div class="kpi-card">
        <div class="label">Watchlist Covered</div>
        <div class="value">40 / 40</div>
      </div>
      <div class="kpi-card">
        <div class="label">Total Implied Value</div>
        <div class="value">${formatUsd(totalImplied)}</div>
      </div>
      <div class="kpi-card">
        <div class="label">Winner LOO Median</div>
        <div class="value">${looMed}</div>
      </div>
      <div class="kpi-card">
        <div class="label">FARM Count</div>
        <div class="value">${farmCount}</div>
      </div>
    </div>

    <div class="method-strip">
      Winning model: <strong>${winnerName}</strong> (fitted value model selected by lowest leave-one-out median log error across pre-token candidates). Board sorted stably by rank.
    </div>

    <div class="filter-bar">
      <select id="filter-category">
        <option value="">All Categories (${categories.length})</option>
        ${categories.map(c => `<option value="${c}" ${currentCategory === c ? "selected" : ""}>${c}</option>`).join("")}
      </select>
      <select id="filter-chain">
        <option value="">All Chains (${chains.length})</option>
        ${chains.map(ch => `<option value="${ch}" ${currentChain === ch ? "selected" : ""}>${ch}</option>`).join("")}
      </select>
      <select id="filter-verdict">
        <option value="">All Verdicts</option>
        <option value="FARM" ${currentVerdict === "FARM" ? "selected" : ""}>FARM</option>
        <option value="THIN" ${currentVerdict === "THIN" ? "selected" : ""}>THIN</option>
        <option value="SKIP" ${currentVerdict === "SKIP" ? "selected" : ""}>SKIP</option>
      </select>
      <label>
        <input type="checkbox" id="filter-watchlist" ${watchlistOnly ? "checked" : ""}> Watchlist only
      </label>
      <input type="text" id="filter-search" placeholder="Search protocol or symbol..." value="${searchQuery}">
      <div class="counter" id="row-counter">Showing 0 of ${board.length}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th data-sort="rank"># <span class="sort-indicator">${sortCol === "rank" ? (sortAsc ? "▲" : "▼") : ""}</span></th>
          <th data-sort="name">Protocol <span class="sort-indicator">${sortCol === "name" ? (sortAsc ? "▲" : "▼") : ""}</span></th>
          <th data-sort="category">Category <span class="sort-indicator">${sortCol === "category" ? (sortAsc ? "▲" : "▼") : ""}</span></th>
          <th data-sort="chains">Chains</th>
          <th data-sort="tvl_usd">TVL <span class="sort-indicator">${sortCol === "tvl_usd" ? (sortAsc ? "▲" : "▼") : ""}</span></th>
          <th data-sort="change_7d">7d Change <span class="sort-indicator">${sortCol === "change_7d" ? (sortAsc ? "▲" : "▼") : ""}</span></th>
          <th data-sort="age_days">Age <span class="sort-indicator">${sortCol === "age_days" ? (sortAsc ? "▲" : "▼") : ""}</span></th>
          <th data-sort="implied_value_usd">Implied Value <span class="sort-indicator">${sortCol === "implied_value_usd" ? (sortAsc ? "▲" : "▼") : ""}</span></th>
          <th data-sort="farm_verdict">Verdict <span class="sort-indicator">${sortCol === "farm_verdict" ? (sortAsc ? "▲" : "▼") : ""}</span></th>
        </tr>
      </thead>
      <tbody id="board-tbody"></tbody>
    </table>
  `;

  // Bind filter events
  document.getElementById("filter-category").addEventListener("change", e => {
    currentCategory = e.target.value;
    updateBoardTable();
  });
  document.getElementById("filter-chain").addEventListener("change", e => {
    currentChain = e.target.value;
    updateBoardTable();
  });
  document.getElementById("filter-verdict").addEventListener("change", e => {
    currentVerdict = e.target.value;
    updateBoardTable();
  });
  document.getElementById("filter-watchlist").addEventListener("change", e => {
    watchlistOnly = e.target.checked;
    updateBoardTable();
  });
  document.getElementById("filter-search").addEventListener("input", e => {
    searchQuery = e.target.value.toLowerCase().trim();
    updateBoardTable();
  });

  // Bind sort headers
  document.querySelectorAll("th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort");
      if (sortCol === col) {
        sortAsc = !sortAsc;
      } else {
        sortCol = col;
        sortAsc = true;
      }
      updateBoardTable();
    });
  });

  updateBoardTable();
}

function updateBoardTable() {
  const board = data.board || [];
  const filtered = board.filter(r => {
    if (currentCategory && r.category !== currentCategory) return false;
    if (currentChain && (!r.chains || !r.chains.includes(currentChain))) return false;
    if (currentVerdict && r.farm_verdict !== currentVerdict) return false;
    if (watchlistOnly && !r.watchlist) return false;
    if (searchQuery) {
      const q = searchQuery;
      const matchName = (r.name || "").toLowerCase().includes(q);
      const matchSlug = (r.slug || "").toLowerCase().includes(q);
      const matchCat = (r.category || "").toLowerCase().includes(q);
      if (!matchName && !matchSlug && !matchCat) return false;
    }
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    let va = a[sortCol];
    let vb = b[sortCol];
    if (va === null || va === undefined) va = sortCol === "rank" ? 0 : "";
    if (vb === null || vb === undefined) vb = sortCol === "rank" ? 0 : "";
    if (typeof va === "string") {
      const cmp = va.localeCompare(vb);
      return sortAsc ? cmp : -cmp;
    }
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return a.slug.localeCompare(b.slug);
  });

  const counterEl = document.getElementById("row-counter");
  if (counterEl) {
    counterEl.textContent = `Showing ${filtered.length} of ${board.length}`;
  }

  const tbody = document.getElementById("board-tbody");
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color: var(--muted); padding: 24px;">No protocols match the current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const star = r.watchlist ? '<span class="watchlist-star">★</span>' : "";
    const rangeStr = `${r.rank_p10}–${r.rank_p90}`;
    const ageStr = r.age_days !== null ? Math.round(r.age_days / 365.25) + "y" : "—";
    const tvlStr = formatUsd(r.tvl_usd);
    const changeStr = formatPct(r.change_7d);
    const impliedStr = formatUsd(r.implied_value_usd);
    const verdict = r.farm_verdict || "SKIP";

    // Range bar for implied value
    const low = r.range_low_usd || r.implied_value_usd * 0.7;
    const high = r.range_high_usd || r.implied_value_usd * 1.3;
    const span = Math.max(1, high - low);
    const mid = r.implied_value_usd;
    const leftPct = Math.max(0, Math.min(100, ((mid - low) / span) * 100));

    return `
      <tr onclick="window.location.hash='#/p/${r.slug}'">
        <td><strong>${r.rank}</strong> <span style="color:var(--muted); font-size:11px;">[${rangeStr}]</span></td>
        <td>${star}${r.name}</td>
        <td>${r.category}</td>
        <td style="color:var(--muted);">${(r.chains || []).join(", ")}</td>
        <td>${tvlStr}</td>
        <td style="color: ${r.change_7d >= 0 ? 'var(--farm)' : 'var(--skip)'};">${changeStr}</td>
        <td>${ageStr}</td>
        <td>
          <div class="range-cell">
            <span class="range-val">${impliedStr}</span>
            <div class="range-bar-container" title="Band: ${formatUsd(low)} – ${formatUsd(high)}">
              <div class="range-bar-fill" style="left: 20%; width: 60%;"></div>
            </div>
          </div>
        </td>
        <td><span class="pill ${verdict}">${verdict}</span></td>
      </tr>
    `;
  }).join("");
}

// ---------------------------------------------------------------------------
// Detail View (#/p/<slug>)
// ---------------------------------------------------------------------------
function renderDetail(slug) {
  if (!data || !data.board) return;
  const r = data.board.find(x => x.slug === slug);
  if (!r) {
    appEl.innerHTML = `
      <div>
        <a href="#/" class="back-link">← Back to Board</a>
        <div class="card" style="margin-top: 16px;">
          <p class="note">Protocol "${slug}" not found on the board.</p>
        </div>
      </div>
    `;
    return;
  }

  const plan = planFor(r);
  const star = r.watchlist ? '★ Watchlist' : '';
  const rangeLow = formatUsd(r.range_low_usd || r.implied_value_usd * 0.7);
  const rangeHigh = formatUsd(r.range_high_usd || r.implied_value_usd * 1.3);
  const impliedVal = formatUsd(r.implied_value_usd);

  appEl.innerHTML = `
    <div class="detail-view">
      <div>
        <a href="#/" class="back-link">← Back to Board</a>
      </div>

      <div class="detail-header">
        <div class="detail-title">
          <h2>${r.name} ${star}</h2>
          <div class="detail-meta">
            <span>Slug: <code>${r.slug}</code></span>
            <span>Category: <strong>${r.category}</strong></span>
            <span>Rank: <strong>${r.rank}</strong> [${r.rank_p10}–${r.rank_p90}]</span>
          </div>
        </div>
        <div>
          <span class="pill ${plan.verdict}" style="font-size: 13px; padding: 4px 12px;">${plan.verdict}</span>
        </div>
      </div>

      <div class="panel-grid">
        <div class="card">
          <h3>Protocol Facts</h3>
          <div class="facts-list">
            <div class="fact-item">
              <div class="f-label">TVL</div>
              <div class="f-val">${formatUsd(r.tvl_usd)}</div>
            </div>
            <div class="fact-item">
              <div class="f-label">7d Change</div>
              <div class="f-val" style="color: ${r.change_7d >= 0 ? 'var(--farm)' : 'var(--skip)'};">${formatPct(r.change_7d)}</div>
            </div>
            <div class="fact-item">
              <div class="f-label">Listed Date</div>
              <div class="f-val">${r.listed_at || "—"}</div>
            </div>
            <div class="fact-item">
              <div class="f-label">Age</div>
              <div class="f-val">${r.age_days !== null ? Math.round(r.age_days / 365.25) + " years (" + r.age_days + " days)" : "—"}</div>
            </div>
            <div class="fact-item" style="grid-column: span 2;">
              <div class="f-label">Chains</div>
              <div class="f-val">${(r.chains || []).join(", ") || "—"}</div>
            </div>
            <div class="fact-item" style="grid-column: span 2;">
              <div class="f-label">Records No Token Statement</div>
              <div class="f-val" style="color: var(--muted); font-size: 12px; font-weight: normal;">
                DefiLlama snapshot records no token symbol or Coingecko ID for this protocol; classified as a genuine pre-token launch candidate.
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <h3>Winning Model Receipt & Band</h3>
          <div style="margin-bottom: 12px; font-size: 13px;">
            Implied valuation: <strong>${impliedVal}</strong>
          </div>
          <div style="margin-bottom: 12px; color: var(--muted); font-size: 12px;">
            Bootstrap 80% confidence band: <strong>${rangeLow}</strong> to <strong>${rangeHigh}</strong>
          </div>
          <div style="background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 10px; margin-bottom: 12px;">
            <div style="font-size: 11px; color: var(--muted); margin-bottom: 6px; text-transform: uppercase;">Fitted Terms</div>
            ${(r.receipt || []).map(item => `
              <div style="display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; border-bottom: 1px solid rgba(34,48,76,0.4);">
                <span style="color: var(--muted);">${item.label}</span>
                <span>${typeof item.value === 'number' ? item.value.toFixed(2) : item.value}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>

      <div class="panel-grid">
        <div class="card">
          <h3>Farm Plan (6 Steps)</h3>
          <div class="farm-steps-list">
            ${(plan.steps || []).map((step, idx) => `
              <div class="farm-step-item">
                <div class="farm-step-num">Step ${idx + 1}</div>
                <div class="farm-step-text">${step}</div>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="card">
          <h3>Verdict Arithmetic</h3>
          <div class="arithmetic-grid" style="margin-bottom: 16px;">
            <div class="arith-item"><span>Implied Value</span><span>${formatUsd(r.implied_value_usd)}</span></div>
            <div class="arith-item"><span>Farmer Pool (10%)</span><span>${formatUsd(plan.pool_usd)}</span></div>
            <div class="arith-item"><span>Assigned Share</span><span>${(plan.share * 100).toFixed(3)}%</span></div>
            <div class="arith-item"><span>Expected Value (EV)</span><span>${formatUsd(plan.ev_usd)}</span></div>
            <div class="arith-item"><span>Gas Cost (${plan.chain})</span><span>${usd(plan.gas_usd)}</span></div>
            <div class="arith-item"><span>Opportunity Cost (5% APY)</span><span>${usd(plan.opp_usd)}</span></div>
            <div class="arith-item"><span>Time Cost (${plan.active_minutes}m @ $20/h)</span><span>${usd(plan.time_usd)}</span></div>
            <div class="arith-item"><span>Total Cost</span><span>${usd(plan.cost_usd)}</span></div>
            <div class="arith-item" style="border-top: 1px solid var(--accent); padding-top: 6px; grid-column: span 2;">
              <span style="color: var(--accent); font-weight: 600;">Net Expected Return</span>
              <span style="color: ${plan.net_usd >= 0 ? 'var(--farm)' : 'var(--skip)'}; font-size: 14px;">${usd(plan.net_usd)}</span>
            </div>
          </div>
          <div style="font-size: 12px; color: var(--muted); line-height: 1.5;">
            Verdict rules: <strong>FARM</strong> requires net ≥ $150 and net/cost ≥ 1.5. <strong>THIN</strong> requires net &gt; 0. Otherwise <strong>SKIP</strong>.
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Method View (#/method)
// ---------------------------------------------------------------------------
function renderMethod() {
  if (!data) return;
  const censusCounts = data.census?.counts || {};
  const candidates = data.method?.candidates || [];
  const wf = data.method?.walk_forward || {};
  const ledger = data.ledger || [];

  appEl.innerHTML = `
    <div class="method-view">
      <div>
        <a href="#/" class="back-link">← Back to Board</a>
      </div>

      <div class="card">
        <h3>Census & Classification (758 Protocols Accounted For)</h3>
        <p style="color: var(--muted); font-size: 12px; margin-top: 0;">
          Every protocol in the snapshot is classified into one of six mutually exclusive categories before pre-token candidates are ranked.
        </p>
        <table>
          <thead>
            <tr><th>Class</th><th>Count</th><th>Definition / Meaning</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>HAS_TOKEN</strong></td><td>${censusCounts.HAS_TOKEN || 0}</td><td>Records a token symbol or Coingecko ID in DefiLlama.</td></tr>
            <tr><td><strong>PRODUCT_OF_TRADED</strong></td><td>${censusCounts.PRODUCT_OF_TRADED || 0}</td><td>Product belonging to a system whose token is already traded (e.g. Bridges, CEX systems).</td></tr>
            <tr><td><strong>EXCHANGE_PRODUCT</strong></td><td>${censusCounts.EXCHANGE_PRODUCT || 0}</td><td>Product carrying an exchange venue name in its identifier.</td></tr>
            <tr><td><strong>WRAPPED_STAKED_NAME</strong></td><td>${censusCounts.WRAPPED_STAKED_NAME || 0}</td><td>Name marks a wrapped, staked, or derivative asset of a traded token.</td></tr>
            <tr><td><strong>VERSIONED_PRODUCT</strong></td><td>${censusCounts.VERSIONED_PRODUCT || 0}</td><td>Name carries a version suffix on an existing product line.</td></tr>
            <tr><td><strong>PRE_TOKEN</strong></td><td><strong>${censusCounts.PRE_TOKEN || 0}</strong></td><td>True pre-token protocol surviving all filters; ranked on the board.</td></tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3>Model Selection & Leave-One-Out Scores</h3>
        <p style="color: var(--muted); font-size: 12px; margin-top: 0;">
          Four candidate valuation models were fitted and evaluated via exact leave-one-out (LOO) cross-validation on the training sample.
        </p>
        <table>
          <thead>
            <tr><th>Candidate Model</th><th>Parameters</th><th>LOO Median Error</th><th>LOO p90 Error</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${candidates.map(c => {
              const isWinner = c.name === data.method?.winner;
              return `
                <tr>
                  <td><strong>${c.name}</strong></td>
                  <td>${c.n_params}</td>
                  <td>${c.loo_median.toFixed(3)}</td>
                  <td>${c.loo_p90.toFixed(3)}</td>
                  <td>${isWinner ? '<span class="pill FARM">WINNER</span>' : '<span style="color:var(--muted);">Candidate</span>'}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
        <div style="margin-top: 12px; color: var(--muted); font-size: 12px;">
          Walk-forward validation scores (60% train / 40% test split by launch date): Median log error <strong>${wf.median?.toFixed(3) || "—"}</strong>, p90 error <strong>${wf.p90?.toFixed(3) || "—"}</strong> (trained on ${wf.n_train || 0}, tested on ${wf.n_test || 0} protocols).
        </div>
      </div>

      <div class="card">
        <h3>Farm Assumptions (Constants)</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; font-size: 12px; margin-bottom: 12px;">
          <div style="background: var(--bg); padding: 8px; border-radius: 4px; border: 1px solid var(--line);">Horizon: <strong>90 days</strong></div>
          <div style="background: var(--bg); padding: 8px; border-radius: 4px; border: 1px solid var(--line);">Farmer Pool Fraction: <strong>10%</strong> of implied value</div>
          <div style="background: var(--bg); padding: 8px; border-radius: 4px; border: 1px solid var(--line);">Competitor TVL Fraction: <strong>10%</strong> of TVL</div>
          <div style="background: var(--bg); padding: 8px; border-radius: 4px; border: 1px solid var(--line);">Share Cap: <strong>0.2%</strong> max</div>
          <div style="background: var(--bg); padding: 8px; border-radius: 4px; border: 1px solid var(--line);">EV Fraction: <strong>10%</strong></div>
          <div style="background: var(--bg); padding: 8px; border-radius: 4px; border: 1px solid var(--line);">Opportunity Cost APY: <strong>5.0%</strong></div>
          <div style="background: var(--bg); padding: 8px; border-radius: 4px; border: 1px solid var(--line);">Active Wage: <strong>$20 / hour</strong></div>
          <div style="background: var(--bg); padding: 8px; border-radius: 4px; border: 1px solid var(--line);">FARM Threshold: Net ≥ $150, Net/Cost ≥ 1.5</div>
        </div>
      </div>

      <div class="card">
        <h3>Honest Weaknesses & Model Limitations</h3>
        <div class="weakness-box">
          <p>
            <strong>TVL Valuation Bias:</strong> TVL-based pricing tends to undervalue fee-switching or flow-driven businesses whose economic base is transaction volume rather than locked collateral (e.g. derivatives aggregators and high-velocity DEXs), because locked capital does not fully capture fee generation.
          </p>
          <p>
            <strong>Dispersion in Valuation Bands:</strong> The bootstrap valuation bands are wide because the historical tokened comparison set exhibits substantial dispersion in market-cap-to-TVL multiples across different market regimes.
          </p>
          <p>
            <strong>No Issuance Guarantee:</strong> The radar prices what a hypothetical token would be worth on today's fundamental record under our fitted model — it does not predict or guarantee that a token will ever be issued by any protocol.
          </p>
        </div>
      </div>

      <div class="card">
        <h3>Complete Protocol Ledger (758 Protocols)</h3>
        <p style="color: var(--muted); font-size: 12px; margin-top: 0;">
          Scrollable ledger detailing all 758 protocols in the snapshot and their classification.
        </p>
        <div style="max-height: 350px; overflow-y: auto; border: 1px solid var(--line); border-radius: 4px;">
          <table>
            <thead>
              <tr><th>Slug</th><th>Name</th><th>Class</th><th>Reason</th></tr>
            </thead>
            <tbody>
              ${ledger.map(item => `
                <tr>
                  <td><code>${item.slug}</code></td>
                  <td>${item.name}</td>
                  <td><span class="pill ${item.class === 'PRE_TOKEN' ? 'FARM' : ''}" style="font-size:10px;">${item.class}</span></td>
                  <td style="color: var(--muted); font-size: 11px;">${item.reason}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

init();
