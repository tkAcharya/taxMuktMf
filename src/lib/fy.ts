/** India FY: 1 Apr – 31 Mar. Returns FY start (local midnight, 1 Apr). */
export function getCurrentFinancialYearStartMs(at = Date.now()): number {
  const d = new Date(at)
  const y = d.getFullYear()
  const m = d.getMonth()
  const day = d.getDate()
  const onOrAfterApr1 = m > 3 || (m === 3 && day >= 1)
  const startYear = onOrAfterApr1 ? y : y - 1
  return new Date(startYear, 3, 1).getTime()
}
