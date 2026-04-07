import { LTCG_TAX_FREE_LIMIT } from '../types'
import { formatInr } from '../lib/numbers'

type Props = {
  usedThisFy: number
  plannedGain: number
}

export function TaxLimitBar({ usedThisFy, plannedGain }: Props) {
  const cap = LTCG_TAX_FREE_LIMIT
  const total = Math.min(cap, usedThisFy + plannedGain)
  const pct = Math.min(100, (total / cap) * 100)
  const overPlan = usedThisFy + plannedGain > cap

  return (
    <div className="rounded-lg border border-lab-border bg-lab-surface p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-lab-ink">Tax-free LTCG room</h2>
        <span className="text-xs text-lab-muted">Limit {formatInr(cap)}</span>
      </div>
      <p className="mt-1 text-xs text-lab-muted">
        Booked this FY: <span className="font-medium text-lab-ink">{formatInr(usedThisFy)}</span>
        {' · '}
        This plan: <span className="font-medium text-lab-ink">{formatInr(plannedGain)}</span>
      </p>
      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-lab-border/60">
        <div
          className={`h-full rounded-full transition-all ${overPlan ? 'bg-lab-warn' : 'bg-lab-success'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-lab-muted">
        Remaining after plan:{' '}
        <span className="font-medium text-lab-ink">
          {formatInr(Math.max(0, cap - usedThisFy - plannedGain))}
        </span>
      </p>
    </div>
  )
}
