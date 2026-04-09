import { parseCAS, computeLTCGHarvesting } from './parser.js';

// ── State ─────────────────────────────────────────────────────────────────────
let state = { holdings: [], rawText: '', investor: {}, format: '' };
let ltcgExemption = 125000;
let existingGains = 0;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const S = id => document.getElementById(id);
const screens = {
  upload: S('uploadScreen'), parsing: S('parsingScreen'),
  portfolio: S('portfolioScreen'), ltcg: S('ltcgScreen'),
  raw: S('rawScreen'), error: S('errorScreen'),
};

// ── Upload wiring ─────────────────────────────────────────────────────────────
S('fileInput').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

const dz = S('dropZone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f?.type === 'application/pdf') handleFile(f);
});

S('tryAgainBtn').addEventListener('click', reset);
S('resetBtn').addEventListener('click', reset);

document.querySelectorAll('.tab').forEach(btn =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    switchTab(btn.dataset.tab);
  })
);

// ── File handling ─────────────────────────────────────────────────────────────
async function handleFile(file) {
  showScreen('parsing');
  S('tabs').style.display = 'none';
  S('resetBtn').style.display = 'none';

  const logEl = S('parseLog');
  const log = (msg, type = '') => {
    const d = document.createElement('div');
    d.className = type === 'ok' ? 'log-ok' : type === 'warn' ? 'log-warn' : '';
    d.textContent = (type === 'ok' ? '✓ ' : '  ') + msg;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  };

  S('parsingTitle').textContent = `Reading "${file.name}"…`;
  S('parsingSub').textContent = `${(file.size / 1024).toFixed(0)} KB · CAMS Portfolio Statement`;

  try {
    const buf = await file.arrayBuffer();
    const result = await parseCAS(buf, log);
    state = result;
    log('All done!', 'ok');
    setTimeout(renderResults, 400);
  } catch (err) {
    console.error(err);
    S('errorMsg').textContent = err.message;
    showScreen('error');
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderResults() {
  renderPortfolio();
  renderLTCGSettings();
  renderLTCGResults();
  S('rawText').textContent = state.rawText.slice(0, 10000);
  S('tabs').style.display = 'flex';
  S('resetBtn').style.display = 'flex';
  switchTab('portfolio');
}

function renderPortfolio() {
  const { holdings, investor, format } = state;
  const totalValue   = sum(holdings, h => h.currentValue);
  const totalCost    = sum(holdings, h => h.costValue);
  const totalGain    = totalValue - totalCost;
  const totalLTCG    = sum(holdings, h => h.ltcgGain);
  const overallXIRR  = state.investor?.total_invested
    ? (totalGain / state.investor.total_invested * 100).toFixed(2) : '–';

  S('metricsGrid').innerHTML = `
    ${metric('Current Value', fmt(totalValue), `${holdings.length} holdings`)}
    ${metric('Total Invested', fmt(totalCost), investor.valuation_date ? `as on ${investor.valuation_date}` : '')}
    ${metric('Unrealised P&L', fmt(totalGain), `${totalGain >= 0 ? '+' : ''}${((totalGain/totalCost)*100).toFixed(1)}%`, totalGain >= 0 ? 'pos' : 'neg')}
    ${metric('LTCG Available', fmt(totalLTCG), 'Tax-free harvest', 'pos')}
  `;

  // Header with investor name
  const investorBadge = investor.name && investor.name !== 'Investor'
    ? `<div style="font-size:11px;color:var(--text3);margin-bottom:10px">
        <span style="color:var(--text2);font-weight:500">${investor.name}</span>
        ${investor.email ? ` · ${investor.email}` : ''}
        ${investor.valuation_date ? ` · ${investor.valuation_date}` : ''}
       </div>`
    : '';

  // Group by AMC
  const byAMC = {};
  for (const h of holdings) {
    const amc = guessAMC(h.scheme);
    if (!byAMC[amc]) byAMC[amc] = [];
    byAMC[amc].push(h);
  }

  let html = investorBadge;
  for (const [amc, hs] of Object.entries(byAMC).sort()) {
    const amcVal = sum(hs, h => h.currentValue);
    html += `<div class="section-title" style="margin-top:12px">
      ${amc} <span style="color:var(--text3);font-weight:400">${fmt(amcVal)}</span>
    </div>`;

    for (const h of hs.sort((a, b) => b.currentValue - a.currentValue)) {
      const gainPct = h.costValue > 0 ? ((h.appreciation / h.costValue) * 100).toFixed(1) : '0.0';
      const gainSign = h.appreciation >= 0 ? '+' : '';
      const gcls = h.appreciation >= 0 ? 'pos' : 'neg';
      const ageBadge = h.avgAgeDays > 365
        ? `<span class="badge badge-ltcg">LTCG eligible</span>`
        : `<span class="badge badge-stcg">STCG</span>`;

      html += `<div class="holding-card">
        <div class="holding-row1">
          <div class="holding-name">${h.scheme}</div>
          <div class="holding-value">${fmt(h.currentValue)}</div>
        </div>
        <div class="holding-row2">
          <div class="holding-meta">
            ${h.units.toFixed(3)} units · NAV ₹${h.nav.toFixed(4)}<br>
            Folio ${h.folio} · Age ${h.avgAgeDays}d · XIRR ${h.xirr}%
            ${h.units_gt3yr > 0 ? `<br><span style="color:var(--green)">▲ ${h.units_gt3yr.toFixed(3)} u held >3yr</span>` : ''}
            ${h.units_1to3yr > 0 ? ` · <span style="color:var(--accent)">${h.units_1to3yr.toFixed(3)} u held 1-3yr</span>` : ''}
          </div>
          <div style="text-align:right">
            <div class="holding-gain ${gcls}">${gainSign}${fmt(h.appreciation)} (${gainSign}${gainPct}%)</div>
            <div style="margin-top:4px">${ageBadge}</div>
            ${h.ltcgGain > 0 ? `<div style="font-size:10px;color:var(--green);margin-top:3px">₹${fmt(h.ltcgGain)} LTCG gain</div>` : ''}
          </div>
        </div>
      </div>`;
    }
  }

  S('holdingsTable').innerHTML = html;
}

function renderLTCGSettings() {
  S('ltcgSettings').innerHTML = `
    <div class="ltcg-row">
      <span class="ltcg-label">LTCG exemption limit (₹)</span>
      <input class="ltcg-input" id="exemptionInput" type="number" step="1000" value="${ltcgExemption}" />
    </div>
    <div class="ltcg-row">
      <span class="ltcg-label">Gains already booked this FY (₹)</span>
      <input class="ltcg-input" id="existingInput" type="number" step="1000" value="${existingGains}" />
    </div>
    <div class="ltcg-row" style="margin-top:6px">
      <span class="ltcg-label" style="font-size:10px;color:var(--text3)">
        Sell → reinvest same day = cost basis reset, zero tax
      </span>
      <button class="btn btn-primary btn-sm" id="calcBtn">Calculate</button>
    </div>
  `;
  S('exemptionInput').addEventListener('change', e => { ltcgExemption = +e.target.value || 125000; });
  S('existingInput').addEventListener('change', e => { existingGains = +e.target.value || 0; });
  S('calcBtn').addEventListener('click', () => {
    ltcgExemption = +S('exemptionInput').value || 125000;
    existingGains = +S('existingInput').value || 0;
    renderLTCGResults();
  });
}

function renderLTCGResults() {
  const budget = Math.max(0, ltcgExemption - existingGains);
  const res = computeLTCGHarvesting(state.holdings, budget);
  const el = S('ltcgResults');

  if (!res.toHarvest.length) {
    el.innerHTML = `<div style="text-align:center;padding:30px 0;color:var(--text3)">
      ${state.holdings.length === 0
        ? 'Upload a PDF first.'
        : 'No harvestable LTCG gains found.<br>All equity gains may be short-term, or you\'ve already exhausted the exemption.'}
    </div>`;
    return;
  }

  const taxIfNotHarvested = res.totalHarvestGain * 0.125;
  let html = `
    <div class="ltcg-summary">
      <div class="ltcg-summary-title">Harvesting plan — FY 2025-26</div>
      <div class="ltcg-summary-grid">
        <div><div class="ltcg-s-item-label">Gain to harvest</div><div class="ltcg-s-item-val">${fmt(res.totalHarvestGain)}</div></div>
        <div><div class="ltcg-s-item-label">Remaining budget</div><div class="ltcg-s-item-val">${fmt(budget)}</div></div>
        <div><div class="ltcg-s-item-label">Tax saved (12.5%)</div><div class="ltcg-s-item-val">${fmt(res.taxSaved)}</div></div>
        <div><div class="ltcg-s-item-label">Unused exemption</div><div class="ltcg-s-item-val">${fmt(res.unusedBudget)}</div></div>
      </div>
    </div>
    <div class="section-title">Action: Sell &amp; immediately reinvest</div>
  `;

  for (const h of res.toHarvest) {
    const ltcgAge = h.units_gt3yr > 0 ? `${h.units_gt3yr.toFixed(3)} units >3yr` :
                    h.units_1to3yr > 0 ? `${h.units_1to3yr.toFixed(3)} units 1-3yr` : '';
    html += `
      <div class="harvest-card">
        <div class="harvest-header">
          <div class="harvest-name">${h.scheme}</div>
          <div class="harvest-exempt">+${fmt(h.harvestGain)} tax-free</div>
        </div>
        <div class="harvest-details">
          <div class="harvest-stat">
            <div class="harvest-stat-label">Units to sell</div>
            <div class="harvest-stat-val">${h.unitsToSell.toFixed(3)}</div>
          </div>
          <div class="harvest-stat">
            <div class="harvest-stat-label">Amount (~)</div>
            <div class="harvest-stat-val">${fmt(h.valueToSell)}</div>
          </div>
          <div class="harvest-stat">
            <div class="harvest-stat-label">Avg cost/unit</div>
            <div class="harvest-stat-val">₹${h.costPerUnit.toFixed(2)}</div>
          </div>
        </div>
        <div style="margin-top:6px;font-size:10px;color:var(--text2)">
          ${ltcgAge ? `LTCG lot: ${ltcgAge} · ` : ''}
          Reinvest ₹${fmt(h.valueToSell)} same day at NAV ₹${h.nav.toFixed(4)} → new cost basis reset
        </div>
      </div>`;
  }

  if (budget <= 0) {
    html += `<div style="margin-top:10px;padding:10px 12px;background:var(--amber-bg);border-radius:var(--radius-sm);font-size:11px;color:var(--amber)">
      ⚠ You've already booked ₹${fmt(existingGains)} in LTCG this FY. Any further gains will attract 12.5% tax.
    </div>`;
  }

  el.innerHTML = html;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function metric(label, value, sub = '', cls = 'neu') {
  return `<div class="metric">
    <div class="metric-label">${label}</div>
    <div class="metric-value ${cls}">${value}</div>
    ${sub ? `<div class="metric-sub ${cls}">${sub}</div>` : ''}
  </div>`;
}

function fmt(n) {
  if (n == null || isNaN(n)) return '–';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return sign + '₹' + (abs / 1e7).toFixed(2) + ' Cr';
  if (abs >= 1e5) return sign + '₹' + (abs / 1e5).toFixed(2) + 'L';
  return sign + '₹' + Math.round(abs).toLocaleString('en-IN');
}

function sum(arr, fn) { return arr.reduce((s, x) => s + (fn(x) || 0), 0); }

function guessAMC(scheme) {
  if (/parag parikh|ppfas/i.test(scheme)) return 'PPFAS Mutual Fund';
  if (/sbi/i.test(scheme)) return 'SBI Mutual Fund';
  if (/tata/i.test(scheme)) return 'Tata Mutual Fund';
  if (/hdfc/i.test(scheme)) return 'HDFC Mutual Fund';
  if (/icici/i.test(scheme)) return 'ICICI Prudential';
  if (/axis/i.test(scheme)) return 'Axis Mutual Fund';
  if (/mirae/i.test(scheme)) return 'Mirae Asset';
  if (/kotak/i.test(scheme)) return 'Kotak Mutual Fund';
  if (/nippon|reliance/i.test(scheme)) return 'Nippon India';
  if (/quant/i.test(scheme)) return 'Quant Mutual Fund';
  if (/motilal/i.test(scheme)) return 'Motilal Oswal';
  if (/dsp/i.test(scheme)) return 'DSP Mutual Fund';
  if (/aditya birla|absl/i.test(scheme)) return 'Aditya Birla Sun Life';
  if (/franklin/i.test(scheme)) return 'Franklin Templeton';
  if (/invesco/i.test(scheme)) return 'Invesco';
  if (/uti/i.test(scheme)) return 'UTI Mutual Fund';
  return 'Other';
}

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => el.style.display = k === name ? 'block' : 'none');
}

function switchTab(tab) {
  showScreen(tab);
}

function reset() {
  state = { holdings: [], rawText: '', investor: {}, format: '' };
  S('tabs').style.display = 'none';
  S('resetBtn').style.display = 'none';
  S('fileInput').value = '';
  S('parseLog').innerHTML = '';
  document.querySelector('.tab[data-tab="portfolio"]').click();
  showScreen('upload');
}

showScreen('upload');
