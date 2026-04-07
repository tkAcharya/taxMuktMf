import type { HarvestEvent } from '../types'
import { formatInr, formatUnits } from '../lib/numbers'

type Props = {
  events: HarvestEvent[]
  onSavePlan: () => void
  saving: boolean
  canSave: boolean
  onExport: () => void
  onImportClick: () => void
}

export function LedgerPanel({ events, onSavePlan, saving, canSave, onExport, onImportClick }: Props) {
  const recent = [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, 12)

  return (
    <div className="rounded-lg border border-lab-border bg-lab-surface shadow-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-lab-border px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold text-lab-ink">Harvest ledger</h2>
          <p className="text-xs text-lab-muted">{events.length} event(s) stored locally</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onSavePlan}
            disabled={!canSave || saving}
            className="rounded-md bg-lab-accent px-2.5 py-1 text-xs font-medium text-white shadow-sm disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Log plan to ledger'}
          </button>
          <button
            type="button"
            onClick={onExport}
            className="rounded-md border border-lab-border bg-white px-2.5 py-1 text-xs font-medium text-lab-ink hover:bg-lab-bg"
          >
            Backup JSON
          </button>
          <button
            type="button"
            onClick={onImportClick}
            className="rounded-md border border-lab-border bg-white px-2.5 py-1 text-xs font-medium text-lab-ink hover:bg-lab-bg"
          >
            Import
          </button>
        </div>
      </div>
      <div className="max-h-40 overflow-auto">
        {recent.length === 0 ? (
          <p className="px-3 py-4 text-xs text-lab-muted text-center">No harvest events yet.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-lab-surface text-lab-muted">
              <tr className="border-b border-lab-border">
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">Scheme</th>
                <th className="px-2 py-2 text-right">Units</th>
                <th className="px-2 py-2 text-right">Gain</th>
                <th className="px-2 py-2 text-right">New basis</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id} className="border-b border-lab-border/60 last:border-0">
                  <td className="px-2 py-1.5 text-lab-muted whitespace-nowrap">
                    {new Date(e.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="px-2 py-1.5 max-w-[100px] truncate" title={e.schemeName}>
                    {e.schemeName}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatUnits(e.unitsHarvested)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatInr(e.realizedGain)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatInr(e.newCostBasis)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
