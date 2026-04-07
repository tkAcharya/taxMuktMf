import type { HarvestSuggestion } from '../types'
import { formatInr, formatUnits } from '../lib/numbers'

type Props = {
  rows: HarvestSuggestion[]
}

export function SuggestionsTable({ rows }: Props) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-lab-border border-dashed bg-lab-surface/50 px-3 py-4 text-center text-xs text-lab-muted">
        No LTCG harvest suggestions yet. Upload a CAS with Section 5 buckets and positive LTCG gain per unit.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-lab-border bg-lab-surface shadow-card overflow-hidden">
      <div className="border-b border-lab-border px-3 py-2">
        <h2 className="text-sm font-semibold text-lab-ink">Suggestions</h2>
        <p className="text-xs text-lab-muted">Best-first by % appreciation — within ₹1,25,000 LTCG exemption</p>
      </div>
      <div className="max-h-56 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-lab-surface text-lab-muted">
            <tr className="border-b border-lab-border">
              <th className="px-2 py-2">Scheme</th>
              <th className="px-2 py-2 text-right">Units to sell</th>
              <th className="px-2 py-2 text-right">Re-invest</th>
              <th className="px-2 py-2 text-right">Tax saved*</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.schemeName} className="border-b border-lab-border/70 last:border-0 hover:bg-lab-bg/80">
                <td className="px-2 py-1.5 text-lab-ink leading-snug max-w-[130px]">{r.schemeName}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatUnits(r.unitsToSell)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatInr(r.reinvestAmount)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-lab-success">{formatInr(r.estimatedTaxSaved)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[10px] text-lab-muted border-t border-lab-border">
        *Illustrative 10% LTCG on booked gain (exemption consumed, not additional tax due).
      </p>
    </div>
  )
}
