import { parseCAS, computeLTCGHarvesting, fetchLiveNAVs, fetchFundMeta, saveState, loadState, clearState } from './parser.js';

// ── State ─────────────────────────────────────────────────────────────────────
const STORAGE_VERSION = 4; // bump this whenever parser changes break saved state
let state = { investor:{}, holdings:[], rawText:'', format:'' };
let liveNAVs = {};
let ledger = []; // [{id, date, type, schemeCode, schemeName, units, navAtTime, value, gain, note}]
let ltcgExemption = 125000, existingGains = 0;
let newsRendered = false, companiesRendered = false;
let privacyMode = false;

const S = id => document.getElementById(id);
const COLORS = ['#4f8ef7','#22c55e','#f59e0b','#ef4444','#a78bfa','#06b6d4','#f97316','#ec4899'];

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const saved = await loadState();
  if (saved) {
    // Invalidate saved state if storage version has changed (parser may have changed)
    if ((saved.version || 0) < STORAGE_VERSION) {
      await clearState();
      privacyMode = false;
      console.log('Storage version mismatch — cleared stale cache. Please re-upload your PDF.');
      const note = S('staleCacheNote');
      if (note) note.style.display = 'block';
    } else {
      state = saved.state || state;
      ledger = saved.ledger || [];
      ltcgExemption = saved.ltcgExemption || 125000;
      existingGains = saved.existingGains || 0;
      privacyMode = saved.privacyMode || false;
      applyPrivacyIcon();
      if (state.holdings?.length) {
        showResultUI();
        renderResults();
        showScreen('portfolioScreen');
        document.querySelector('.tab[data-tab="portfolio"]').classList.add('active');
        fetchLiveNAVs(state.holdings).then(navs => {
          liveNAVs = navs; injectLiveNAVs(); renderPortfolio();
        }).catch(() => {});
      }
    }
  }
  if (!state.holdings?.length) showScreen('uploadScreen');
  applyPrivacyIcon();
})();

// ── Upload wiring ─────────────────────────────────────────────────────────────
S('fileInput').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
const dz = S('dropZone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag');
  if (e.dataTransfer.files[0]?.type === 'application/pdf') handleFile(e.dataTransfer.files[0]);
});
S('tryAgainBtn').addEventListener('click', doReset);
S('resetBtn').addEventListener('click', doReset);
document.querySelectorAll('.tab').forEach(btn =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    showScreen(tab + 'Screen');
    if (tab === 'news' && !newsRendered && state.holdings.length) renderNews();
    if (tab === 'holdings' && !companiesRendered && state.holdings.length) renderCompanies();
    if (tab === 'ledger') renderLedger();
  })
);

// ── File handling ─────────────────────────────────────────────────────────────
function setProgress(pct, label, sub) {
  pct = Math.min(pct, 100);
  const bar = S('progressBar');
  const pctEl = S('progressPct');
  const ring = S('progressRing');
  if (bar) bar.style.width = pct + '%';
  if (pctEl) pctEl.textContent = Math.round(pct) + '%';
  if (ring) ring.style.strokeDashoffset = 188.5 * (1 - pct / 100);
  if (label) S('parsingTitle').textContent = label;
  if (sub !== undefined) S('parsingSub').textContent = sub || '';
}

async function handleFile(file) {
  showScreen('parsingScreen');
  S('tabs').style.display = 'none';
  S('resetBtn').style.display = 'none';
  const logEl = S('parseLog');
  const log = (msg, type='') => {
    const d = document.createElement('div');
    d.className = type==='ok'?'log-ok':type==='warn'?'log-warn':'';
    d.textContent = (type==='ok'?'✓ ':'  ') + msg;
    logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
  };
  setProgress(5, `Reading "${file.name}"…`, `${(file.size/1024).toFixed(0)} KB`);
  let totalPages = 5;
  const progressLog = (msg, type) => {
    log(msg, type);
    const pm = msg.match(/Page (\d+)\/(\d+)/);
    if (pm) { totalPages = parseInt(pm[2]); setProgress(5 + parseInt(pm[1])/totalPages*45); }
    if (msg.includes('Investor:'))    setProgress(52, 'Found investor…');
    if (msg.includes('holdings parsed')) setProgress(62, `Parsed ${state.holdings?.length || ''} holdings…`);
    if (msg.includes('aging'))        setProgress(70, 'Parsing aging buckets…');
  };
  try {
    state = await parseCAS(await file.arrayBuffer(), progressLog);
    setProgress(72, 'PDF parsed ✓');
    log('PDF parsed', 'ok');
    setProgress(75, 'Fetching live NAVs from AMFI…');
    log('Fetching live NAVs from AMFI…');
    try {
      liveNAVs = await fetchLiveNAVs(state.holdings);
      injectLiveNAVs();
      log(`${Object.keys(liveNAVs).length} NAVs verified`, 'ok');
      setProgress(90, `${Object.keys(liveNAVs).length}/${state.holdings.length} NAVs matched ✓`);
    } catch { log('NAV fetch failed (check connection)', 'warn'); setProgress(90); }
    setProgress(95, 'Saving…');
    await persist();
    log('Saved to Chrome storage', 'ok');
    setProgress(100, 'Done!');
    setTimeout(() => {
      showResultUI();
      renderResults();
      showScreen('portfolioScreen');
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelector('.tab[data-tab="portfolio"]').classList.add('active');
    }, 450);
  } catch (err) {
    console.error(err); S('errorMsg').textContent = err.message; showScreen('errorScreen');
  }
}

function injectLiveNAVs() {
  for (const h of state.holdings) {
    const m = liveNAVs[h.schemeCode];
    if (m) { h.liveNAV = m.nav; h.navDiff = Math.abs(h.nav - m.nav)/m.nav*100; h.amfiCode = m.amfiCode; }
  }
}

function showResultUI() {
  S('tabs').style.display = 'flex'; S('resetBtn').style.display = 'flex';
  S('savedBadge').style.display = 'inline';
}

function renderResults() {
  renderPortfolio(); renderLTCGSettings(); renderLTCGResults();
  S('rawText').textContent = state.rawText.slice(0, 14000);
}

// ── Portfolio + Pie chart ─────────────────────────────────────────────────────
function renderPortfolio() {
  const h = state.holdings;
  const totVal = sum(h, x => x.currentValue), totCost = sum(h, x => x.costValue);
  const totGain = totVal - totCost, totLTCG = sum(h, x => x.ltcgGain);
  const wXIRR = h.length ? (h.reduce((s,x)=>s+x.xirr*x.currentValue,0)/totVal).toFixed(1) : 0;

  S('metricsGrid').innerHTML = [
    metric('Current Value', fmt(totVal), `${h.length} holdings`),
    metric('Total Invested', fmt(totCost), state.investor.valuation_date||''),
    metric('Unrealised P&L', fmt(totGain), `${sign(totGain)}${((totGain/totCost)*100).toFixed(1)}%`, totGain>=0?'pos':'neg'),
    metric('LTCG Available', fmt(totLTCG), `Wtd XIRR ${wXIRR}%`, 'pos'),
  ].join('');

  // Pie chart
  renderPie(h);

  const inv = state.investor;
  S('investorBar').innerHTML = `
    <span class="investor-name">${inv.name||''}</span>
    ${inv.email ? `<span>·</span><span>${inv.email}</span>` : ''}
    ${inv.valuation_date ? `<span>·</span><span>${inv.valuation_date}</span>` : ''}
    ${Object.keys(liveNAVs).length ? `<span class="nav-badge">✓ NAVs live</span>` : ''}
  `;

  const byAMC = groupBy(h, x => guessAMC(x.scheme));
  let html = '';
  for (const [amc, items] of Object.entries(byAMC).sort()) {
    html += `<div class="section-title" style="margin-top:10px">${amc}<span style="color:var(--text3);font-weight:400;margin-left:6px">${fmt(sum(items,x=>x.currentValue))}</span></div>`;
    for (const x of items.sort((a,b)=>b.currentValue-a.currentValue)) {
      const pct = x.costValue>0?((x.appreciation/x.costValue)*100).toFixed(1):'0.0';
      const gcls = x.appreciation>=0?'pos':'neg';
      const ltcgLine = x.ltcgGain>0 ? `<div style="font-size:10px;color:var(--green);margin-top:2px">${fmt(x.ltcgGain)} LTCG gain</div>` : '';
      const navLine = x.liveNAV!=null ? (x.navDiff<1 ? `<div class="nav-ok">✓ live ₹${x.liveNAV.toFixed(4)}</div>` : `<div class="nav-diff">⚠ live ₹${x.liveNAV.toFixed(4)} (${x.navDiff.toFixed(1)}% diff)</div>`) : '';
      const aging = [
        x.units_lt1yr>0?`<span style="color:var(--text3)">${x.units_lt1yr.toFixed(3)}u &lt;1yr</span>`:'',
        x.units_1to3yr>0?`<span style="color:var(--accent)">${x.units_1to3yr.toFixed(3)}u 1-3yr</span>`:'',
        x.units_gt3yr>0?`<span style="color:var(--green)">${x.units_gt3yr.toFixed(3)}u &gt;3yr</span>`:'',
      ].filter(Boolean).join(' · ');
      const ageBadge = (x.units_1to3yr+x.units_gt3yr)>0 ? `<span class="badge badge-ltcg">LTCG</span>` : `<span class="badge badge-stcg">STCG</span>`;
      html += `<div class="holding-card">
        <div class="hc-top"><div class="hc-name">${x.scheme}</div><div class="hc-value">${fmt(x.currentValue)}</div></div>
        <div class="hc-mid">
          <div class="hc-meta">${x.units.toFixed(3)} units · NAV ₹${x.nav.toFixed(4)}<br>
            Folio ${x.folio} · Age ${x.avgAgeDays}d · XIRR ${x.xirr}%<br>${aging}</div>
          <div class="hc-right">
            <div class="hc-gain ${gcls}">${sign(x.appreciation)}${fmt(x.appreciation)} (${sign(x.appreciation)}${pct}%)</div>
            <div style="margin-top:3px">${ageBadge}</div>${ltcgLine}${navLine}
          </div>
        </div>
      </div>`;
    }
  }
  S('holdingsTable').innerHTML = html;
}

function renderPie(holdings) {
  const totVal = sum(holdings, h => h.currentValue);
  const slices = holdings.map((h,i) => ({
    name: h.scheme.replace(/\(.*?\)/g,'').trim().substring(0,28),
    value: h.currentValue, pct: h.currentValue/totVal*100,
    color: COLORS[i % COLORS.length],
  })).sort((a,b)=>b.value-a.value);

  const size = 110;
  let html = `<div class="pie-wrap">
    <canvas id="pieCanvas" width="${size}" height="${size}"></canvas>
    <div class="pie-legend">`;
  for (const s of slices) {
    html += `<div class="pie-legend-item">
      <span class="pie-dot" style="background:${s.color}"></span>
      <span class="pie-name">${s.name}</span>
      <span class="pie-pct">${s.pct.toFixed(1)}%</span>
    </div>`;
  }
  html += `</div></div>`;
  S('pieContainer').innerHTML = html;

  // Draw pie
  const canvas = S('pieCanvas');
  const ctx = canvas.getContext('2d');
  const cx = size/2, cy = size/2, r = size/2 - 4;
  let angle = -Math.PI/2;
  for (const s of slices) {
    const sweep = (s.pct/100) * Math.PI*2;
    ctx.beginPath(); ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,angle,angle+sweep);
    ctx.closePath(); ctx.fillStyle = s.color; ctx.fill();
    ctx.strokeStyle = '#0c0c10'; ctx.lineWidth = 1.5; ctx.stroke();
    angle += sweep;
  }
  // Center donut hole
  ctx.beginPath(); ctx.arc(cx,cy,r*0.45,0,Math.PI*2);
  ctx.fillStyle = '#13131a'; ctx.fill();
}

// ── LTCG ──────────────────────────────────────────────────────────────────────
// Use a single delegated listener on the static ltcgScreen container so the
// calcBtn always works even when ltcgSettings innerHTML is re-rendered.
(function wireLTCGDelegation() {
  S('ltcgScreen').addEventListener('click', e => {
    if (e.target.id === 'calcBtn' || e.target.closest('#calcBtn')) {
      runCalculate();
    }
  });
  // `input` fires on every keystroke; `change` fires on blur — handle both
  // so globals are always current regardless of how the user interacts
  const syncInputs = e => {
    if (e.target.id === 'exemptionInput') {
      const v = parseFloat(e.target.value);
      ltcgExemption = (!isNaN(v) && v >= 0) ? v : 125000;
    }
    if (e.target.id === 'existingInput') {
      const v = parseFloat(e.target.value);
      existingGains = (!isNaN(v) && v >= 0) ? v : 0;
    }
  };
  S('ltcgScreen').addEventListener('input',  syncInputs);
  S('ltcgScreen').addEventListener('change', e => { syncInputs(e); persist(); });
}());

function runCalculate() {
  // Read current input values
  ltcgExemption = +(S('exemptionInput')?.value) || 125000;
  existingGains = +(S('existingInput')?.value)  || 0;

  // Disable button and show loading state
  const btn = S('calcBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Calculating…'; btn.style.opacity = '0.6'; }

  // Show inline progress bar inside ltcgResults while computing
  const el = S('ltcgResults');
  el.innerHTML = `
    <div style="padding:20px 0">
      <div style="font-size:12px;color:var(--text2);margin-bottom:10px;text-align:center">
        Computing harvesting plan…
      </div>
      <div style="height:3px;background:var(--bg3);border-radius:2px;overflow:hidden">
        <div id="ltcgCalcBar" style="height:100%;width:0%;background:linear-gradient(90deg,var(--accent),var(--green));border-radius:2px;transition:width 0.25s ease"></div>
      </div>
    </div>`;

  // Animate the bar across three micro-ticks so the browser actually paints it
  requestAnimationFrame(() => {
    const bar = S('ltcgCalcBar');
    if (bar) bar.style.width = '30%';
    setTimeout(() => {
      if (bar) bar.style.width = '70%';
      setTimeout(() => {
        if (bar) bar.style.width = '100%';
        setTimeout(() => {
          renderLTCGResults();
          persist();
          // Re-enable button
          const b = S('calcBtn');
          if (b) { b.disabled = false; b.textContent = 'Calculate'; b.style.opacity = ''; }
        }, 120);
      }, 80);
    }, 80);
  });
}

function renderLTCGSettings() {
  S('ltcgSettings').innerHTML = `
    <div class="ltcg-row"><span class="ltcg-label">LTCG exemption limit (₹)</span><input class="ltcg-input" id="exemptionInput" type="number" step="1000" value="${ltcgExemption}"/></div>
    <div class="ltcg-row">
      <span class="ltcg-label tooltip-wrap">
        Gains already booked this FY (₹)
        <span class="tooltip-icon">?
          <span class="tooltip-bubble">
            Enter LTCG you've already booked this FY.<br>
            This number must exceed your <strong>unused exemption</strong> (₹${fmt(Math.max(0, ltcgExemption - sum(state.holdings, h => h.ltcgGain||0)))} remaining) to reduce the suggested harvest.
          </span>
        </span>
      </span>
      <input class="ltcg-input" id="existingInput" type="number" step="1000" value="${existingGains}"/>
    </div>
    <div class="ltcg-row" style="margin-top:4px">
      <span class="ltcg-label" style="font-size:10px;color:var(--text3)">Sell → reinvest same day · cost basis resets · zero tax</span>
      <button class="btn btn-primary btn-sm" id="calcBtn">Calculate</button>
    </div>`;
}

function renderLTCGResults() {
  // Always read directly from DOM inputs so we get the live typed value,
  // not a potentially stale global. Fall back to globals when inputs aren't rendered.
  const exemptEl = S('exemptionInput');
  const existEl  = S('existingInput');
  const curExemption = exemptEl ? (parseFloat(exemptEl.value) || ltcgExemption) : ltcgExemption;
  const curExisting  = existEl  ? (parseFloat(existEl.value)  || 0)              : existingGains;
  // Sync globals so the summary display uses the same values
  ltcgExemption = curExemption;
  existingGains = curExisting;

  const budget = Math.max(0, ltcgExemption - existingGains);
  const res = computeLTCGHarvesting(state.holdings, budget);
  const el = S('ltcgResults');

  // Total available LTCG (even if over budget)
  const totalAvailLTCG = sum(state.holdings, h => h.ltcgGain || 0);

  if (!res.toHarvest.length && totalAvailLTCG <= 0) {
    const noLTCGFunds = state.holdings.filter(h => h.avgAgeDays < 365).map(h => h.scheme.split(' ').slice(0,3).join(' ')).join(', ');
    el.innerHTML = `<div style="text-align:center;padding:28px;color:var(--text3);font-size:12px">
      No harvestable LTCG gains right now.<br>
      ${noLTCGFunds ? `<span style="font-size:10px">Holdings not yet 1yr old: ${noLTCGFunds}</span>` : ''}
    </div>`;
    return;
  }

  if (!res.toHarvest.length && budget <= 0) {
    el.innerHTML = `<div style="padding:12px;background:var(--amber-bg);border:0.5px solid var(--amber-border);border-radius:var(--radius-sm);font-size:12px;color:var(--amber)">
      ⚠ You've already booked ₹${fmt(existingGains)} in LTCG this FY — no exemption budget remaining.<br>
      <span style="font-size:10px">You still have ${fmt(totalAvailLTCG)} of LTCG gains available, but they'll attract 12.5% tax if booked now.</span>
    </div>`;
    return;
  }

  // Tax context: if you DON'T harvest, these gains will be taxable when you eventually sell
  // If you DO harvest (sell+reinvest), you pay 0 now and reset cost basis
  const gainsOverExemption = Math.max(0, existingGains + res.totalHarvestGain - ltcgExemption);
  const taxThisYear = gainsOverExemption * 0.125;
  const futureTaxIfNotHarvested = Math.min(res.totalHarvestGain, budget) * 0.125; // tax you'd pay next FY
  const leftoverLTCG = totalAvailLTCG - res.totalHarvestGain;

  el.innerHTML = `
    <div class="ltcg-summary">
      <div class="ltcg-summary-title">Harvesting Plan — FY 2025-26</div>
      <div class="ltcg-summary-grid">
        <div><div class="ls-label">Gain to book</div><div class="ls-val">${fmt(res.totalHarvestGain)}</div></div>
        <div><div class="ls-label">Tax this year</div><div class="ls-val" style="color:${taxThisYear>0?'var(--amber)':'var(--green)'}">${taxThisYear>0?fmt(taxThisYear):'₹0'}</div></div>
        <div><div class="ls-label">Future tax saved</div><div class="ls-val">${fmt(futureTaxIfNotHarvested)}</div></div>
        <div><div class="ls-label">Unused exemption</div><div class="ls-val">${fmt(res.unusedBudget)}</div></div>
      </div>
    </div>
    ${leftoverLTCG > 0 ? `<div style="margin-bottom:10px;padding:8px 12px;background:var(--bg3);border-radius:var(--radius-sm);font-size:11px;color:var(--text2)">
      ℹ ${fmt(leftoverLTCG)} more LTCG available beyond exemption limit — will attract 12.5% if booked this FY.
    </div>` : ''}
    <div class="section-title">Action: sell &amp; immediately reinvest</div>
    ${res.toHarvest.map(h => {
      const costPU = h.units>0 ? h.costValue/h.units : 0;
      const lt = [h.units_gt3yr>0?`${h.units_gt3yr.toFixed(3)}u >3yr`:'', h.units_1to3yr>0?`${h.units_1to3yr.toFixed(3)}u 1-3yr`:''].filter(Boolean).join(', ');
      return `<div class="harvest-card">
        <div class="hv-top"><div class="hv-name">${h.scheme}</div><div class="hv-gain">+${fmt(h.harvestGain)} tax-free</div></div>
        <div class="hv-grid">
          <div><div class="hv-stat-label">Units to sell</div><div class="hv-stat-val">${h.unitsToSell.toFixed(3)}</div></div>
          <div><div class="hv-stat-label">Value (~)</div><div class="hv-stat-val">${fmt(h.valueToSell)}</div></div>
          <div><div class="hv-stat-label">Avg cost/unit</div><div class="hv-stat-val">₹${costPU.toFixed(2)}</div></div>
        </div>
        <div class="hv-note">${lt ? `Eligible lots: ${lt} · ` : ''}Sell ${fmt(h.valueToSell)} → reinvest same day at NAV ₹${h.nav.toFixed(4)} → cost basis reset to ₹${costPU>0?(h.nav).toFixed(2):'–'}/unit</div>
      </div>`;
    }).join('')}
    ${budget<=0?`<div style="margin-top:8px;padding:9px 12px;background:var(--amber-bg);border:0.5px solid var(--amber-border);border-radius:var(--radius-sm);font-size:11px;color:var(--amber)">⚠ LTCG budget exhausted this FY — any gains now taxed at 12.5%.</div>`:''}
  `;
}

// ── Ledger ────────────────────────────────────────────────────────────────────
let showAddForm = false;

function renderLedger() {
  const el = S('ledgerContent');
  const totalGain = sum(ledger, e => e.gain||0);
  const totalVal = sum(ledger, e => e.value||0);

  let html = `<div class="ledger-toolbar">
    <button class="btn btn-primary btn-sm" id="addEntryBtn">${showAddForm?'✕ Cancel':'+ Add Entry'}</button>
    <div class="ledger-toolbar-right">
      <button class="btn btn-sm" id="exportLedgerBtn">Export JSON</button>
      <button class="btn btn-sm" id="importLedgerBtn">Import JSON</button>
      <input type="file" id="importLedgerFile" accept=".json" style="display:none"/>
    </div>
  </div>`;

  if (showAddForm) {
    const fundOptions = state.holdings.map(h => `<option value="${h.schemeCode}">${h.scheme}</option>`).join('');
    html += `<div class="add-entry-form">
      <div class="form-row">
        <div class="form-field"><label>Type</label>
          <select id="lType"><option value="harvest">Tax Harvest (Sell+Reinvest)</option><option value="sell">Partial Sell</option><option value="buy">Purchase</option></select>
        </div>
        <div class="form-field"><label>Date</label><input type="date" id="lDate" value="${new Date().toISOString().split('T')[0]}"/></div>
      </div>
      <div class="form-row">
        <div class="form-field"><label>Fund</label><select id="lFund">${fundOptions}</select></div>
        <div class="form-field"><label>Units transacted</label><input type="number" id="lUnits" step="0.001" placeholder="0.000"/></div>
      </div>
      <div class="form-row">
        <div class="form-field"><label>NAV at time (₹)</label><input type="number" id="lNAV" step="0.0001" placeholder="auto-fill from PDF"/></div>
        <div class="form-field"><label>Note (optional)</label><input type="text" id="lNote" placeholder="e.g. FY25-26 tax harvest"/></div>
      </div>
      <div class="form-actions"><button class="btn btn-primary btn-sm" id="saveEntryBtn">Save Entry</button></div>
    </div>`;
  }

  if (!ledger.length) {
    html += `<div class="ledger-empty">No entries yet.<br>Add your first reharvesting or sell transaction above.</div>`;
  } else {
    html += `<div class="section-title">
      ${ledger.length} entries · Total value ${fmt(totalVal)} · Total gain booked ${fmt(totalGain)}
    </div>`;
    for (const e of [...ledger].reverse()) {
      const badgeCls = e.type==='harvest'?'le-harvest':'le-sell';
      const badgeLabel = e.type==='harvest'?'Tax Harvest':e.type==='buy'?'Purchase':'Sell';
      html += `<div class="ledger-entry" id="le-${e.id}">
        <div class="le-top">
          <div class="le-name">${e.schemeName}</div>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="le-badge ${badgeCls}">${badgeLabel}</span>
            <span class="le-date">${e.date}</span>
            <button class="btn btn-ghost btn-sm" onclick="deleteLedgerEntry('${e.id}')">✕</button>
          </div>
        </div>
        <div class="le-details">
          <div><div class="le-stat-label">Units</div><div class="le-stat-val">${e.units.toFixed(3)}</div></div>
          <div><div class="le-stat-label">NAV</div><div class="le-stat-val">₹${e.navAtTime.toFixed(4)}</div></div>
          <div><div class="le-stat-label">Value</div><div class="le-stat-val">${fmt(e.value)}</div></div>
          <div><div class="le-stat-label">Est. Gain</div><div class="le-stat-val ${e.gain>=0?'pos':'neg'}">${fmt(e.gain)}</div></div>
        </div>
        ${e.note?`<div class="le-note">${e.note}</div>`:''}
      </div>`;
    }
  }

  el.innerHTML = html;

  S('addEntryBtn').addEventListener('click', () => { showAddForm = !showAddForm; renderLedger(); });
  S('exportLedgerBtn').addEventListener('click', exportLedger);
  S('importLedgerBtn').addEventListener('click', () => S('importLedgerFile').click());
  S('importLedgerFile').addEventListener('change', e => { if (e.target.files[0]) importLedger(e.target.files[0]); });

  if (showAddForm) {
    S('saveEntryBtn').addEventListener('click', addLedgerEntry);
    // Auto-fill NAV when fund changes
    S('lFund').addEventListener('change', e => {
      const h = state.holdings.find(h => h.schemeCode === e.target.value);
      if (h) S('lNAV').value = h.liveNAV || h.nav;
    });
    // Set initial NAV
    const firstFund = state.holdings[0];
    if (firstFund) S('lNAV').value = firstFund.liveNAV || firstFund.nav;
  }
}

function addLedgerEntry() {
  const schemeCode = S('lFund').value;
  const holding = state.holdings.find(h => h.schemeCode === schemeCode);
  const units = parseFloat(S('lUnits').value) || 0;
  const navAtTime = parseFloat(S('lNAV').value) || holding?.nav || 0;
  const type = S('lType').value;
  const date = S('lDate').value;
  const note = S('lNote').value.trim();

  if (!units || !navAtTime) { alert('Please enter units and NAV.'); return; }

  const value = units * navAtTime;
  const costPerUnit = holding ? (holding.costValue / holding.units) : 0;
  const gain = type === 'buy' ? 0 : (navAtTime - costPerUnit) * units;

  ledger.push({
    id: Date.now().toString(),
    date, type, schemeCode,
    schemeName: holding?.scheme || schemeCode,
    units, navAtTime, value, gain, note,
  });

  showAddForm = false;
  persist();
  renderLedger();
}

window.deleteLedgerEntry = id => {
  if (!confirm('Delete this entry?')) return;
  ledger = ledger.filter(e => e.id !== id);
  persist(); renderLedger();
};

function exportLedger() {
  const data = JSON.stringify({ exportDate: new Date().toISOString(), investor: state.investor?.name, ledger }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `cas-ledger-${new Date().toISOString().split('T')[0]}.json`;
  a.click(); URL.revokeObjectURL(url);
}

function importLedger(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.ledger)) throw new Error('Invalid format');
      if (confirm(`Import ${data.ledger.length} entries? This will merge with existing ledger.`)) {
        const existingIds = new Set(ledger.map(e => e.id));
        data.ledger.filter(e => !existingIds.has(e.id)).forEach(e => ledger.push(e));
        persist(); renderLedger();
      }
    } catch { alert('Invalid JSON file.'); }
  };
  reader.readAsText(file);
}

// ── Companies tab (fund holdings via mfapi) ───────────────────────────────────
async function renderCompanies() {
  companiesRendered = true;
  const el = S('companiesContent');

  const fundsWithCode = state.holdings.filter(h => h.amfiCode);
  if (!fundsWithCode.length) {
    el.innerHTML = `<div class="news-loading">Connect to internet and reload to fetch fund holdings data.</div>`; return;
  }

  el.innerHTML = `<div class="news-loading">Fetching portfolio holdings from mfapi.in…</div>`;
  let html = '';

  for (const h of fundsWithCode) {
    try {
      const meta = await fetchFundMeta(h.amfiCode);
      const holdings = meta.meta || {};

      html += `<div class="fund-section">
        <div class="fund-section-title">
          ${h.scheme}
          <span style="font-size:10px;font-weight:400;color:var(--text3)">${holdings.scheme_category||''}</span>
        </div>
        <div class="fund-meta-row">
          <div class="fund-meta-item"><span class="fund-meta-label">AMC: </span><span class="fund-meta-val">${holdings.fund_house||'–'}</span></div>
          <div class="fund-meta-item"><span class="fund-meta-label">Type: </span><span class="fund-meta-val">${holdings.scheme_type||'–'}</span></div>
          <div class="fund-meta-item"><span class="fund-meta-label">ISIN: </span><span class="fund-meta-val">${holdings.scheme_code||h.amfiCode}</span></div>
          <div class="fund-meta-item"><span class="fund-meta-label">Your XIRR: </span><span class="fund-meta-val" style="color:${h.xirr>=0?'var(--green)':'var(--red)'}">${h.xirr}%</span></div>
        </div>`;

      // mfapi doesn't provide stock holdings, so offer external link
      html += `<div style="font-size:10px;color:var(--text3);margin-bottom:5px">Stock holdings (via AMC factsheet or Tickertape):</div>
        <a class="ext-link" href="https://tickertape.in/mutual-funds/${encodeURIComponent(h.scheme.toLowerCase().replace(/[^a-z0-9]+/g,'-'))}" target="_blank">Tickertape ↗</a>
        <a class="ext-link" href="https://www.valueresearchonline.com/funds/portfolios/?q=${encodeURIComponent(h.scheme)}" target="_blank">Value Research ↗</a>
        <a class="ext-link" href="https://www.morningstar.in/mutualfunds/searchResults.aspx?search=${encodeURIComponent(h.scheme.split(' ').slice(0,3).join('+'))}" target="_blank">Morningstar ↗</a>
      </div><div class="divider"></div>`;
    } catch {
      html += `<div class="fund-section"><div class="fund-section-title">${h.scheme}</div><div style="font-size:11px;color:var(--text3)">Data unavailable.</div></div>`;
    }
  }

  el.innerHTML = html || `<div class="news-loading">No data found.</div>`;
}

// ── News tab ──────────────────────────────────────────────────────────────────
async function fetchGoogleNewsRSS(query) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' mutual fund')}&hl=en-IN&gl=IN&ceid=IN:en`;
    const resp = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    const json = await resp.json();
    const xml = new DOMParser().parseFromString(json.contents, 'text/xml');
    const items = [...xml.querySelectorAll('item')].slice(0, 4);
    return items.map(item => ({
      title: item.querySelector('title')?.textContent?.replace(/<[^>]+>/g,'') || '',
      link: item.querySelector('link')?.textContent || '',
      pubDate: item.querySelector('pubDate')?.textContent || '',
      source: item.querySelector('source')?.textContent || '',
    })).filter(a => a.title);
  } catch { return []; }
}

async function renderNews() {
  newsRendered = true;
  const el = S('newsContent');
  el.innerHTML = `<div class="news-loading">Loading news for ${state.holdings.length} funds…</div>`;

  let html = '';
  for (const h of state.holdings) {
    let metaHtml = '', newsHtml = '', navHtml = '';

    // Fund meta + NAV history from mfapi
    if (h.amfiCode) {
      try {
        const meta = await fetchFundMeta(h.amfiCode);
        const recent = (meta.data||[]).slice(0,5);
        const trend = recent.length>=2
          ? ((parseFloat(recent[0].nav)-parseFloat(recent[recent.length-1].nav))/parseFloat(recent[recent.length-1].nav)*100).toFixed(2)
          : null;
        metaHtml = `<div class="fund-meta-row">
          ${meta.meta?.fund_house?`<div class="fund-meta-item"><span class="fund-meta-label">AMC: </span><span class="fund-meta-val">${meta.meta.fund_house}</span></div>`:''}
          ${meta.meta?.scheme_category?`<div class="fund-meta-item"><span class="fund-meta-label">Category: </span><span class="fund-meta-val">${meta.meta.scheme_category}</span></div>`:''}
          ${trend!==null?`<div class="fund-meta-item"><span class="fund-meta-label">5-day: </span><span class="fund-meta-val" style="color:${parseFloat(trend)>=0?'var(--green)':'var(--red)'}">${trend}%</span></div>`:''}
          <div class="fund-meta-item"><span class="fund-meta-label">Your gain: </span><span class="fund-meta-val ${h.appreciation>=0?'pos':'neg'}">${fmt(h.appreciation)} (${h.xirr}%)</span></div>
        </div>`;
        if (recent.length) {
          navHtml = `<div class="nav-history">${recent.map(d=>`<div class="nav-day"><div class="nav-day-date">${d.date}</div><div class="nav-day-val">₹${parseFloat(d.nav).toFixed(2)}</div></div>`).join('')}</div>`;
        }
      } catch {}
    }

    // News articles from Google News RSS via allorigins proxy
    const shortName = h.scheme.split(' ').slice(0,4).join(' ').replace(/\(.*\)/,'').trim();
    const articles = await fetchGoogleNewsRSS(shortName);
    if (articles.length) {
      newsHtml = `<div style="font-size:10px;color:var(--text3);margin-bottom:5px;margin-top:6px">Latest news</div>
        ${articles.map(a => {
          const when = a.pubDate ? new Date(a.pubDate).toLocaleDateString('en-IN',{day:'numeric',month:'short'}) : '';
          return `<a class="news-article" href="${a.link}" target="_blank">
            <div class="news-article-title">${a.title.replace(/\s*-\s*[^-]+$/, '')}</div>
            <div class="news-article-meta">${a.source ? a.source + ' · ' : ''}${when}</div>
          </a>`;
        }).join('')}`;
    } else {
      newsHtml = `<div style="font-size:10px;color:var(--text3);margin-top:6px">News unavailable. Search directly:</div>`;
    }

    html += `<div class="fund-section">
      <div class="fund-section-title">${h.scheme}</div>
      ${metaHtml}${navHtml}${newsHtml}
      <div style="margin-top:7px">
        <a class="ext-link" href="https://www.google.com/search?q=${encodeURIComponent(shortName+' mutual fund news')}&tbm=nws">Google News ↗</a>
        <a class="ext-link" href="https://economictimes.indiatimes.com/search?q=${encodeURIComponent(shortName)}">ET ↗</a>
        <a class="ext-link" href="https://www.moneycontrol.com/mutual-funds/nav/search-results.php?search_data=${encodeURIComponent(shortName)}">MC ↗</a>
      </div>
    </div><div class="divider"></div>`;

    // Update progressively as we load each fund
    el.innerHTML = html + `<div class="news-loading" style="padding:10px">Loading remaining funds…</div>`;
  }
  el.innerHTML = html || `<div class="news-loading">No data.</div>`;
}

// ── Persistence ───────────────────────────────────────────────────────────────
async function persist() {
  await saveState({ version: STORAGE_VERSION, state, ledger, ltcgExemption, existingGains, privacyMode });
}

async function doReset() {
  if (!confirm('Reset and clear all saved data?')) return;
  await clearState();
  state = { investor:{}, holdings:[], rawText:'', format:'' };
  liveNAVs = {}; ledger = []; newsRendered = false; companiesRendered = false;
  privacyMode = false;
  applyPrivacyIcon();
  S('tabs').style.display = 'none'; S('resetBtn').style.display = 'none';
  S('savedBadge').style.display = 'none';
  S('fileInput').value = ''; S('parseLog').innerHTML = '';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.tab[data-tab="portfolio"]').classList.add('active');
  showScreen('uploadScreen');
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function metric(label, val, sub='', cls='neu') {
  return `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value ${cls}">${val}</div>${sub?`<div class="metric-sub ${cls}">${sub}</div>`:''}</div>`;
}
function fmt(n) {
  if (n==null||isNaN(n)) return '–';
  if (privacyMode) {
    // Replace each digit with X, keep ₹ sign, suffix, separators
    const a=Math.abs(n),s=n<0?'-':'';
    let str;
    if(a>=1e7) str = s+'₹'+(a/1e7).toFixed(2)+' Cr';
    else if(a>=1e5) str = s+'₹'+(a/1e5).toFixed(2)+'L';
    else str = s+'₹'+Math.round(a).toLocaleString('en-IN');
    return str.replace(/\d/g, 'X');
  }
  const a=Math.abs(n),s=n<0?'-':'';
  if(a>=1e7) return s+'₹'+(a/1e7).toFixed(2)+' Cr';
  if(a>=1e5) return s+'₹'+(a/1e5).toFixed(2)+'L';
  return s+'₹'+Math.round(a).toLocaleString('en-IN');
}
function sign(n) { return n>=0?'+':''; }
function sum(arr, fn) { return arr.reduce((s,x)=>s+(fn(x)||0),0); }
function groupBy(arr, fn) { return arr.reduce((m,x)=>{ const k=fn(x); if(!m[k])m[k]=[]; m[k].push(x); return m; },{}); }
function guessAMC(s) {
  if(/parag parikh|ppfas/i.test(s)) return 'PPFAS';
  if(/^sbi/i.test(s)) return 'SBI';
  if(/^tata/i.test(s)) return 'Tata';
  if(/^hdfc/i.test(s)) return 'HDFC';
  if(/icici prud/i.test(s)) return 'ICICI Prudential';
  if(/^axis/i.test(s)) return 'Axis';
  if(/mirae/i.test(s)) return 'Mirae Asset';
  if(/kotak/i.test(s)) return 'Kotak';
  if(/nippon|reliance/i.test(s)) return 'Nippon India';
  if(/quant/i.test(s)) return 'Quant';
  if(/motilal/i.test(s)) return 'Motilal Oswal';
  if(/dsp/i.test(s)) return 'DSP';
  if(/aditya birla|absl/i.test(s)) return 'Aditya Birla Sun Life';
  if(/franklin/i.test(s)) return 'Franklin Templeton';
  if(/uti/i.test(s)) return 'UTI';
  return 'Other';
}
function applyPrivacyIcon() {
  const eye = S('eyeIcon'), eyeOff = S('eyeOffIcon'), btn = S('privacyBtn');
  if (!eye || !btn) return;
  btn.disabled = false;
  btn.style.opacity = '';
  eye.style.display = privacyMode ? 'none' : 'block';
  eyeOff.style.display = privacyMode ? 'block' : 'none';
  btn.style.color = privacyMode ? 'var(--amber)' : '';
  btn.title = privacyMode ? 'Privacy mode ON — click to show values' : 'Hide monetary values';
  document.body.classList.toggle('privacy-on', privacyMode);
}

S('privacyBtn').addEventListener('click', () => {
  privacyMode = !privacyMode;
  applyPrivacyIcon();
  persist();
  // Re-render all active content so masking applies immediately
  if (state.holdings?.length) {
    renderResults();
    if (newsRendered) { newsRendered = false; renderNews(); }
    if (companiesRendered) { companiesRendered = false; renderCompanies(); }
    renderLedger();
  }
});

function showScreen(id) {
  ['uploadScreen','parsingScreen','portfolioScreen','ltcgScreen','ledgerScreen','holdingsScreen','newsScreen','rawScreen','errorScreen']
    .forEach(sid => S(sid).style.display = sid===id ? 'block' : 'none');
}
