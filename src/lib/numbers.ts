/** Parse numeric strings with commas / Indian grouping; strips spaces. */
export function parseIndianNumber(raw: string): number {
  const trimmed = raw.trim().replace(/\s+/g, '')
  if (!trimmed) return NaN
  const normalized = trimmed.replace(/,/g, '')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : NaN
}

export function roundUnits(n: number, decimals = 4): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

export function formatInr(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(n))
}

export function formatInrNav(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n)
}

export function formatUnits(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 4 })
}
