import type { FundRow } from '../types'
import { formatInrNav, formatUnits } from '../lib/numbers'

type Props = {
  funds: FundRow[]
  included: Record<string, boolean>
  onToggle: (schemeName: string, value: boolean) => void
}

export function FundsTable({ funds, included, onToggle }: Props) {
  if (!funds.length) return null

  return (
    <div className="rounded-lg border border-lab-border bg-lab-surface shadow-card overflow-hidden">
      <div className="border-b border-lab-border px-3 py-2">
        <h2 className="text-sm font-semibold text-lab-ink">Portfolio (parsed)</h2>
        <p className="text-xs text-lab-muted">Uncheck to exclude from harvest logic</p>
      </div>
      <div className="max-h-48 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-lab-surface text-lab-muted">
            <tr className="border-b border-lab-border">
              <th className="px-2 py-2 w-8" />
              <th className="px-2 py-2">Scheme</th>
              <th className="px-2 py-2 text-right">LTCG u.</th>
              <th className="px-2 py-2 text-right">STCG u.</th>
              <th className="px-2 py-2 text-right">Avg NAV</th>
              <th className="px-2 py-2 text-right">NAV</th>
            </tr>
          </thead>
          <tbody>
            {funds.map((f) => {
              const on = included[f.schemeName] !== false
              return (
                <tr key={f.schemeName} className="border-b border-lab-border/70 last:border-0 hover:bg-lab-bg/80">
                  <td className="px-2 py-1.5 align-top">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => onToggle(f.schemeName, e.target.checked)}
                      className="rounded border-lab-border text-lab-accent focus:ring-lab-accent"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-lab-ink leading-snug max-w-[140px]">{f.schemeName}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatUnits(f.ltcgUnits)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatUnits(f.stcgUnits)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-lab-muted">{formatInrNav(f.avgNav)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatInrNav(f.currentNav)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
