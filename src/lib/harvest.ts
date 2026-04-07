import type { FundRow, HarvestSuggestion } from '../types'
import { LTCG_TAX_FREE_LIMIT } from '../types'
import { roundUnits } from './numbers'

/** Best-first: highest % appreciation among LTCG-eligible units, greedy fill to limit. */
export function computeHarvestSuggestions(
  funds: FundRow[],
  included: Record<string, boolean>,
  alreadyRealizedThisFy: number,
): HarvestSuggestion[] {
  let remaining = Math.max(0, LTCG_TAX_FREE_LIMIT - alreadyRealizedThisFy)
  const ranked = funds
    .filter((f) => included[f.schemeName] !== false)
    .map((f) => {
      const gainPerUnit = f.currentNav - f.avgNav
      const pct = f.avgNav > 0 ? (gainPerUnit / f.avgNav) * 100 : 0
      return { f, gainPerUnit, pct }
    })
    .filter((x) => x.gainPerUnit > 0 && x.f.ltcgUnits > 0)
    .sort((a, b) => b.pct - a.pct)

  const out: HarvestSuggestion[] = []
  for (const { f, gainPerUnit: gpu } of ranked) {
    if (included[f.schemeName] === false) continue
    const maxFromHoldings = f.ltcgUnits * gpu
    const gainToBook = Math.min(maxFromHoldings, remaining)
    if (gainToBook <= 1e-6) continue
    let unitsToSell = gainToBook / gpu
    unitsToSell = Math.min(unitsToSell, f.ltcgUnits)
    const u = roundUnits(unitsToSell)
    const realizedGain = u * gpu
    remaining -= realizedGain
    out.push({
      schemeName: f.schemeName,
      unitsToSell: u,
      reinvestAmount: u * f.currentNav,
      estimatedTaxSaved: realizedGain * 0.1,
      realizedGain,
    })
    if (remaining <= 1e-6) break
  }
  return out
}

export function sumRealizedGainsSince(events: { timestamp: number; realizedGain: number }[], sinceMs: number): number {
  return events.filter((e) => e.timestamp >= sinceMs).reduce((s, e) => s + e.realizedGain, 0)
}
