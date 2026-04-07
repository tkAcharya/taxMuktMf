export type FundRow = {
  schemeName: string
  ltcgUnits: number
  stcgUnits: number
  avgNav: number
  currentNav: number
}

export type HarvestEvent = {
  id: string
  timestamp: number
  schemeName: string
  unitsHarvested: number
  realizedGain: number
  newCostBasis: number
}

export type HarvestSuggestion = {
  schemeName: string
  unitsToSell: number
  reinvestAmount: number
  estimatedTaxSaved: number
  realizedGain: number
}

export const LTCG_TAX_FREE_LIMIT = 125_000

export const STORAGE_KEYS = {
  harvestEvents: 'harvestEvents',
} as const
