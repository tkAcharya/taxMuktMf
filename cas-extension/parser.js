/**
 * CAMS CAS / Portfolio Statement Parser (Production)
 *
 * Handles the CAMS "Portfolio Valuation" PDF format:
 *  - Page 1: Investor info + portfolio summary
 *  - Page 2: Section 2 — holdings table (scheme, folio, units, nav, value, cost, appreciation, age, xirr)
 *  - Page 5: Section 5 — aging analysis (units split into <1yr, 1-3yr, >3yr buckets)
 *
 * Two-column aging layout on page 5 is handled with a left/right context state machine.
 */

import * as pdfjsLib from './lib/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href;

// ─── Entry point ───────────────────────────────────────────────────────────────
export async function parseCAS(arrayBuffer, log = () => {}) {
  log('Loading PDF…');
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  log(`${doc.numPages} pages detected`, 'ok');

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(reconstructLines(content.items));
    log(`Page ${i}/${doc.numPages} read`);
  }

  const pageTexts = pages.map(p => p.map(l => l.text).join('\n'));
  const allText = pageTexts.join('\n');

  const format = allText.includes('CAMS') ? 'CAMS Portfolio Valuation'
               : allText.includes('KFin') ? 'KFintech CAS'
               : 'Generic CAS';
  log(`Format: ${format}`, 'ok');

  log('Parsing investor info…');
  const investor = parseInvestor(allText);
  log(`Investor: ${investor.name}`, 'ok');

  log('Parsing holdings…');
  const holdings = parseHoldings(allText);
  log(`${holdings.length} holdings found`, 'ok');

  if (holdings.length === 0) {
    throw new Error('No holdings found. This PDF format may not be supported yet. Check the Raw Data tab.');
  }

  log('Parsing aging buckets…');
  const aging = parseAging(allText);
  log(`${Object.keys(aging).length} aging entries`, 'ok');

  log('Computing LTCG eligibility…');
  mergeAging(holdings, aging);

  return { investor, holdings, rawText: allText, format, pages: doc.numPages };
}

// ─── Line reconstruction from PDF.js items ────────────────────────────────────
function reconstructLines(items) {
  if (!items.length) return [];
  const map = new Map();
  for (const item of items) {
    const y = Math.round(item.transform[5]);
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(item);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([y, its]) => ({
      y,
      text: its
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map(i => i.str).join(' ')
        .replace(/\s+/g, ' ').trim()
    }))
    .filter(l => l.text.length > 0);
}

// ─── Investor info ────────────────────────────────────────────────────────────
function parseInvestor(text) {
  const email = (text.match(/Email:\s*([\w.+\-]+@[\w.\-]+)/) || [])[1] || '';
  const mobile = (text.match(/Mobile:\s*(\+?\d[\d\s\-]+)/) || [])[1]?.trim() || '';
  const date = (text.match(/Portfolio Valuation as on (\d{2}\/\d{2}\/\d{4})/) || [])[1] || '';
  const totalInvested = parseNum(
    (text.match(/total investment of Rs ([\d,]+\.\d{2})/) || [])[1] || '0'
  );
  // Name extraction: look for name line that appears right before address block
  const nameM = text.match(/\n([A-Z][a-z]+(?: [A-Z][a-z]+){1,3})\n[A-Z\d]/);
  const name = nameM ? nameM[1].trim() : 'Investor';

  return { name, email, mobile, valuation_date: date, total_invested: totalInvested };
}

// ─── Holdings (Section 2) ─────────────────────────────────────────────────────
function parseHoldings(allText) {
  const holdings = [];

  // Extract Section 2 only (stop at Section 3)
  const sec2 = allText.match(/Section 2\s*:([\s\S]*?)(?=Section 3)/)?.[1] || allText;

  // Each holding line matches:
  // <Scheme Name> <Type> <Folio> <Investor Name> <Units> <DD/MM/YYYY> <CurVal> <CostVal> <Appreciation> <AgeDays>*? <XIRR>%
  const re = /^(.+?)\s+(Equity|Debt|Hybrid|Balanced|FOF)\s+(\S+)\s+([\w ]+?)\s+([\d,]+\.\d{3})\s+(\d{2}\/\d{2}\/\d{4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+(\d+)\*?\s+(-?\d+\.\d{2})%/gm;

  let m;
  while ((m = re.exec(sec2)) !== null) {
    const units = parseNum(m[5]);
    const currentValue = parseNum(m[7]);
    const costValue = parseNum(m[8]);

    holdings.push({
      scheme: cleanName(m[1]),
      rawScheme: m[1].trim(),
      fundType: m[2],
      folio: m[3].trim(),
      investorName: m[4].trim(),
      units,
      navDate: m[6],
      nav: units > 0 ? Math.round((currentValue / units) * 10000) / 10000 : 0,
      currentValue,
      costValue,
      appreciation: parseNum(m[9]),
      avgAgeDays: parseInt(m[10]),
      xirr: parseFloat(m[11]),
      // Aging (filled after merge)
      units_lt1yr: 0,
      units_1to3yr: 0,
      units_gt3yr: 0,
      ltcgEligibleUnits: 0,
      ltcgGain: 0,
      stcgGain: 0,
    });
  }

  // Deduplicate — Sections 2 and 3 have same data
  const seen = new Set();
  return holdings.filter(h => {
    const key = `${h.folio}|${h.scheme.substring(0, 25)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Aging (Section 5) ────────────────────────────────────────────────────────
function parseAging(allText) {
  const sec5 = allText.match(/Section 5:([\s\S]*?)(?=This service comes|Notes\n|$)/)?.[1] || '';
  const aging = {};

  const BK = b => b.includes('0-365') ? 'units_lt1yr'
                : b.includes('366') ? 'units_1to3yr'
                : 'units_gt3yr';

  const getCode = scheme => {
    const m = scheme.match(/\(([A-Z0-9]+)\)/);
    return m ? m[1] : scheme.replace(/[^A-Z0-9]/gi, '').substring(0, 8).toUpperCase();
  };

  const ensureEntry = (folio, scheme) => {
    const key = `${folio}|${getCode(scheme)}`;
    if (!aging[key]) aging[key] = { folio, scheme: scheme.trim(), units_lt1yr: 0, units_1to3yr: 0, units_gt3yr: 0 };
    return key;
  };

  // Full entry: "folio scheme units bucket"
  const reFull = /^([\d][\d/]+)\s+(.+?)\s+([\d,]+\.\d{3})\s+(0-365|366-1095|> 1095)\s+days/;
  // Continuation: "units bucket" only
  const reCont = /^([\d,]+\.\d{3})\s+(0-365|366-1095|> 1095)\s+days/;

  // Split line at two-column boundary: after "days " followed by a digit
  const splitLine = line => {
    const m = line.match(/^(.*?days)\s+(\d.*)$/);
    return m ? [m[1].trim(), m[2].trim()] : [line.trim(), ''];
  };

  const processHalf = (text, ctx) => {
    if (!text) return ctx;
    let m = reFull.exec(text);
    if (m) {
      const key = ensureEntry(m[1], m[2]);
      aging[key][BK(m[4])] += parseNum(m[3]);
      return key;
    }
    m = reCont.exec(text);
    if (m && ctx) {
      aging[ctx][BK(m[2])] += parseNum(m[1]);
      return ctx;
    }
    return ctx;
  };

  let leftCtx = null, rightCtx = null;
  for (const line of sec5.split('\n')) {
    const t = line.trim();
    if (!t || /^(Folio|Section|This service)/i.test(t)) continue;
    const [left, right] = splitLine(t);
    leftCtx = processHalf(left, leftCtx);
    rightCtx = processHalf(right, rightCtx);
  }

  return aging;
}

// ─── Merge aging into holdings ────────────────────────────────────────────────
function mergeAging(holdings, aging) {
  for (const h of holdings) {
    const codeM = h.rawScheme.match(/\(([A-Z0-9]+)\)/);
    const code = codeM ? codeM[1] : '';
    const key = `${h.folio}|${code}`;
    const a = aging[key];

    if (a) {
      h.units_lt1yr = a.units_lt1yr;
      h.units_1to3yr = a.units_1to3yr;
      h.units_gt3yr = a.units_gt3yr;
    } else {
      // Fallback estimate from weighted avg age
      if (h.avgAgeDays > 1095) {
        h.units_gt3yr = h.units;
      } else if (h.avgAgeDays > 365) {
        h.units_1to3yr = h.units;
      } else {
        h.units_lt1yr = h.units;
      }
    }

    const costPerUnit = h.units > 0 ? h.costValue / h.units : 0;
    const gainPerUnit = h.nav - costPerUnit;
    const isDebt = ['Debt', 'FOF'].includes(h.fundType);

    // LTCG threshold: equity = 1yr, debt = 3yr
    const ltcgUnits = isDebt ? h.units_gt3yr : (h.units_1to3yr + h.units_gt3yr);
    const stcgUnits = isDebt ? (h.units_lt1yr + h.units_1to3yr) : h.units_lt1yr;

    h.ltcgEligibleUnits = ltcgUnits;
    h.ltcgGain = Math.max(0, gainPerUnit * ltcgUnits);
    h.stcgGain = Math.max(0, gainPerUnit * stcgUnits);
  }
}

// ─── LTCG Harvesting Calculator ───────────────────────────────────────────────
export function computeLTCGHarvesting(holdings, budgetRemaining = 125000) {
  const eligible = holdings
    .filter(h => !['Debt', 'FOF'].includes(h.fundType) && h.ltcgGain > 1)
    .sort((a, b) => b.ltcgGain - a.ltcgGain);

  const toHarvest = [];
  let totalHarvestGain = 0;

  for (const h of eligible) {
    if (budgetRemaining <= 0) break;
    const harvestGain = Math.min(h.ltcgGain, budgetRemaining);
    const costPerUnit = h.units > 0 ? h.costValue / h.units : 0;
    const gainPerUnit = h.nav - costPerUnit;
    const unitsToSell = gainPerUnit > 0
      ? Math.min(harvestGain / gainPerUnit, h.ltcgEligibleUnits)
      : 0;

    toHarvest.push({
      ...h,
      harvestGain,
      unitsToSell,
      valueToSell: unitsToSell * h.nav,
      costPerUnit,
    });

    budgetRemaining -= harvestGain;
    totalHarvestGain += harvestGain;
  }

  return {
    toHarvest,
    totalHarvestGain,
    taxSaved: totalHarvestGain * 0.125, // 12.5% LTCG rate
    unusedBudget: Math.max(0, budgetRemaining),
  };
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function parseNum(s) {
  return parseFloat((s || '0').replace(/,/g, '')) || 0;
}

function cleanName(s) {
  return s
    .replace(/\(Non-Demat\)/gi, '')
    .replace(/\(formerly[^)]+\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
