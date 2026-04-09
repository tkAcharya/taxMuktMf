/**
 * CAS Analyzer — parser.js v3
 * Fix: !schemeCode guard (handles undefined AND null) ensures all wrapped-name funds parse
 */
import * as pdfjsLib from './lib/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href;

const AMFI_URL  = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const MFAPI_URL = 'https://api.mfapi.in/mf';

export async function parseCAS(arrayBuffer, log = () => {}) {
  log('Loading PDF…');
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  log(`${doc.numPages} pages found`, 'ok');
  const pageTexts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    pageTexts.push(reconstructText((await page.getTextContent()).items));
    log(`Page ${i}/${doc.numPages} read`);
  }
  const allText = pageTexts.join('\n');
  const format = allText.includes('CAMS') ? 'CAMS Portfolio Valuation' : allText.includes('KFin') ? 'KFintech CAS' : 'Generic CAS';
  log(`Format: ${format}`, 'ok');
  log('Parsing investor…');
  const investor = parseInvestor(allText);
  log(`Investor: ${investor.name}`, 'ok');
  log('Parsing holdings (Section 3 — all funds)…');
  const holdings = parseSection3(allText);
  log(`${holdings.length} holdings parsed`, 'ok');
  if (!holdings.length) throw new Error('No holdings found. Check Raw Data tab.');
  log('Parsing aging (Section 5)…');
  const aging = parseAging(allText);
  log(`${Object.keys(aging).length} aging entries`, 'ok');
  mergeAging(holdings, aging);
  return { investor, holdings, rawText: allText, format, pages: doc.numPages };
}

export async function fetchLiveNAVs(holdings) {
  const resp = await fetch(AMFI_URL);
  const text = await resp.text();
  const navMap = buildNAVMap(text);
  const results = {};
  for (const h of holdings) {
    const match = findBestNAV(navMap, h.scheme);
    if (match) results[h.schemeCode] = match;
  }
  return results;
}

function buildNAVMap(text) {
  const map = {};
  for (const line of text.split('\n')) {
    const parts = line.split(';');
    if (parts.length >= 5) {
      const nav = parseFloat(parts[4]);
      if (!isNaN(nav) && nav > 0 && parts[3]?.trim()) {
        map[parts[3].trim()] = { amfiCode: parts[0]?.trim(), nav, isin: parts[1]?.trim() };
      }
    }
  }
  return map;
}

function expandAbbreviations(name) {
  return name
    .replace(/\bBFS\b/gi, 'Banking Financial Services')
    .replace(/\bINFRA\b/gi, 'Infrastructure')
    .replace(/\bFSC\b/gi, 'Financial Services')
    .replace(/\bMNC\b/gi, 'Multinational')
    .replace(/\bESG\b/gi, 'Environmental Social Governance')
    .replace(/\bIT\b/gi, 'Information Technology')
    .replace(/\bPSU\b/gi, 'Public Sector')
    .replace(/&/g, ' and ');
}

function findBestNAV(navMap, schemeName) {
  const stopWords = new Set(['fund','plan','growth','direct','scheme','open','ended','the','dir','plt','gr','non','demat','based']);
  const tokenize = name => {
    name = expandAbbreviations(name);
    name = name.replace(/\(.*?\)/g,'').replace(/formerly.*/gi,'').replace(/non-demat/gi,'');
    return new Set(
      name.toLowerCase().split(/[\s\-&/()+]+/)
          .map(w => w.trim())
          .filter(w => w.length > 2 && !stopWords.has(w))
    );
  };

  const qWords = tokenize(schemeName);
  let best = null, bestScore = 0;
  for (const [key, val] of Object.entries(navMap)) {
    const kl = key.toLowerCase();
    if (!kl.includes('direct') || !kl.includes('growth')) continue;
    const kWords = tokenize(key);
    const score = [...qWords].filter(w => kWords.has(w)).length;
    if (score > bestScore) { bestScore = score; best = { ...val, name: key }; }
  }
  // Require at least 2 matching tokens
  return bestScore >= 2 ? best : null;
}

export async function fetchFundMeta(amfiCode) {
  const resp = await fetch(`${MFAPI_URL}/${amfiCode}`);
  return await resp.json();
}

function reconstructText(items) {
  if (!items.length) return '';
  const map = new Map();
  for (const item of items) {
    const y = Math.round(item.transform[5]);
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(item);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, its]) => its.sort((a,b)=>a.transform[4]-b.transform[4]).map(i=>i.str).join(' ').replace(/\s+/g,' ').trim())
    .filter(Boolean).join('\n');
}

function parseInvestor(text) {
  return {
    name: (text.match(/\n([A-Z][a-z]+(?: [A-Z][a-z]+){1,3})\n[A-Z\d]/) || [])[1]?.trim() || 'Investor',
    email: (text.match(/Email:\s*([\w.+\-]+@[\w.\-]+)/) || [])[1] || '',
    mobile: (text.match(/Mobile:\s*(\+?\d[\d\s\-]+)/) || [])[1]?.trim() || '',
    valuation_date: (text.match(/Portfolio Valuation as on (\d{2}\/\d{2}\/\d{4})/) || [])[1] || '',
    total_invested: pNum((text.match(/total investment of Rs ([\d,]+\.\d{2})/) || [])[1]),
  };
}

function parseSection3(allText) {
  const sec3 = allText.match(/Section 3\s*:([\s\S]*?)(?=Section 4|$)/)?.[1] || '';
  const lines = sec3.split('\n').map(l => l.trim()).filter(Boolean);
  const dataRe = /^(.*?)\s+(Equity|Debt|Hybrid|Balanced|FOF)\s+(\S+)\s+([\d,]+\.\d{3})\s+(\d{2}\/\d{2}\/\d{4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+(\d+)\*?\s+(-?\d+\.\d{2})%\s*$/;
  const skipRe = /^(Group Total|Total\s*:|Scheme|Tarun|Investor|Section|\$)/i;
  const holdings = [];
  let pending = null;
  const flush = () => { if (pending) { holdings.push({ ...pending }); pending = null; } };

  for (const line of lines) {
    if (skipRe.test(line)) { flush(); continue; }
    const m = dataRe.exec(line);
    if (m) {
      flush();
      const schemeRaw = m[1].trim();
      const codeM = schemeRaw.match(/\(([A-Z0-9]{4,8})\)\s*$/);
      const code = codeM?.[1];
      const isValidCode = code && !/^(Demat|Growth|Direct|Fund|Plan|Value|India|Flexi)$/i.test(code);
      const units = pNum(m[4]), cv = pNum(m[6]);
      pending = {
        scheme: cleanScheme(schemeRaw), rawScheme: schemeRaw,
        schemeCode: isValidCode ? code : null,
        fundType: m[2], folio: m[3], units,
        navDate: m[5], nav: units > 0 ? Math.round(cv/units*10000)/10000 : 0,
        currentValue: cv, costValue: pNum(m[7]), appreciation: pNum(m[8]),
        avgAgeDays: parseInt(m[9]), xirr: parseFloat(m[10]),
        units_lt1yr: 0, units_1to3yr: 0, units_gt3yr: 0,
        ltcgEligibleUnits: 0, ltcgGain: 0, stcgGain: 0,
        liveNAV: null, navDiff: null, amfiCode: null,
      };
    } else if (pending && !pending.schemeCode) {
      // Continuation line with scheme code
      const codeM = line.match(/\(([A-Z0-9]{4,8})\)/);
      if (codeM) {
        pending.rawScheme = pending.rawScheme + ' ' + line;
        pending.scheme = cleanScheme(pending.rawScheme);
        pending.schemeCode = codeM[1];
      }
      flush();
    } else {
      flush();
    }
  }
  flush();
  return holdings;
}

function parseAging(allText) {
  const sec5 = allText.match(/Section 5:([\s\S]*?)(?=This service|Notes\n|$)/)?.[1] || '';
  const aging = {};
  const BK = b => b.includes('0-365') ? 'units_lt1yr' : b.includes('366') ? 'units_1to3yr' : 'units_gt3yr';
  const getCode = s => { const m = s.match(/\(([A-Z0-9]{4,8})\)/); return m?.[1] || s.replace(/[^A-Z0-9]/gi,'').substring(0,8).toUpperCase(); };
  const ensure = (folio, scheme) => {
    const k = `${folio}|${getCode(scheme)}`;
    if (!aging[k]) aging[k] = { folio, scheme: scheme.trim(), units_lt1yr:0, units_1to3yr:0, units_gt3yr:0 };
    return k;
  };
  const reFull = /^([\d][\d/]+)\s+(.+?)\s+([\d,]+\.\d{3})\s+(0-365|366-1095|> 1095)\s+days/;
  const reCont = /^([\d,]+\.\d{3})\s+(0-365|366-1095|> 1095)\s+days/;
  const splitLine = line => { const m = line.match(/^(.*?days)\s+(\d.*)$/); return m ? [m[1].trim(), m[2].trim()] : [line.trim(), '']; };
  const proc = (text, ctx) => {
    if (!text) return ctx;
    let m = reFull.exec(text);
    if (m) { const k = ensure(m[1], m[2]); aging[k][BK(m[4])] += pNum(m[3]); return k; }
    m = reCont.exec(text);
    if (m && ctx) { aging[ctx][BK(m[2])] += pNum(m[1]); return ctx; }
    return ctx;
  };
  let lc = null, rc = null;
  for (const line of sec5.split('\n')) {
    const t = line.trim();
    if (!t || /^(Folio|Section)/i.test(t)) continue;
    const [l, r] = splitLine(t);
    lc = proc(l, lc); rc = proc(r, rc);
  }
  return aging;
}

function mergeAging(holdings, aging) {
  for (const h of holdings) {
    const a = aging[`${h.folio}|${h.schemeCode || ''}`];
    if (a) { h.units_lt1yr = a.units_lt1yr; h.units_1to3yr = a.units_1to3yr; h.units_gt3yr = a.units_gt3yr; }
    else {
      if (h.avgAgeDays > 1095) h.units_gt3yr = h.units;
      else if (h.avgAgeDays > 365) h.units_1to3yr = h.units;
      else h.units_lt1yr = h.units;
    }
    const isDebt = ['Debt','FOF'].includes(h.fundType);
    const ltcgU = isDebt ? h.units_gt3yr : h.units_1to3yr + h.units_gt3yr;
    const costPU = h.units > 0 ? h.costValue / h.units : 0;
    const gainPU = h.nav - costPU;
    h.ltcgEligibleUnits = ltcgU;
    h.ltcgGain = Math.max(0, gainPU * ltcgU);
    h.stcgGain = Math.max(0, gainPU * (isDebt ? h.units_lt1yr + h.units_1to3yr : h.units_lt1yr));
  }
}

export function computeLTCGHarvesting(holdings, budget = 125000) {
  const eligible = holdings.filter(h => !['Debt','FOF'].includes(h.fundType) && h.ltcgGain > 1).sort((a,b) => b.ltcgGain - a.ltcgGain);
  const toHarvest = []; let totalGain = 0;
  for (const h of eligible) {
    if (budget <= 0) break;
    const g = Math.min(h.ltcgGain, budget);
    const costPU = h.units > 0 ? h.costValue / h.units : 0;
    const gainPU = h.nav - costPU;
    const unitsToSell = gainPU > 0 ? Math.min(g / gainPU, h.ltcgEligibleUnits) : 0;
    toHarvest.push({ ...h, harvestGain: g, unitsToSell, valueToSell: unitsToSell * h.nav, costPerUnit: costPU });
    budget -= g; totalGain += g;
  }
  return { toHarvest, totalHarvestGain: totalGain, taxSaved: totalGain * 0.125, unusedBudget: Math.max(0, budget) };
}

export async function saveState(data) {
  return new Promise(resolve => chrome.storage.local.set({ casAnalyzerState: JSON.stringify(data) }, resolve));
}
export async function loadState() {
  return new Promise(resolve =>
    chrome.storage.local.get('casAnalyzerState', r => {
      try { resolve(r.casAnalyzerState ? JSON.parse(r.casAnalyzerState) : null); }
      catch { resolve(null); }
    })
  );
}
export async function clearState() {
  return new Promise(resolve => chrome.storage.local.remove('casAnalyzerState', resolve));
}

function pNum(s) { return parseFloat((s || '0').replace(/,/g,'')) || 0; }
function cleanScheme(s) {
  return s.replace(/\(Non-Demat\)/gi,'').replace(/\(formerly[^)]+\)/gi,'').replace(/\s+/g,' ').trim();
}
