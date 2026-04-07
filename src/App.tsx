import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FundRow, HarvestEvent, HarvestSuggestion } from './types'
import { parseCasPdf } from './lib/pdfParser'
import { computeHarvestSuggestions, sumRealizedGainsSince } from './lib/harvest'
import { getCurrentFinancialYearStartMs } from './lib/fy'
import {
  appendHarvestEvents,
  downloadJson,
  getAllStorage,
  getHarvestEvents,
  importFullStorage,
} from './lib/storage'
import { PdfDropzone } from './components/PdfDropzone'
import { TaxLimitBar } from './components/TaxLimitBar'
import { FundsTable } from './components/FundsTable'
import { SuggestionsTable } from './components/SuggestionsTable'
import { LedgerPanel } from './components/LedgerPanel'

function suggestionsToEvents(rows: HarvestSuggestion[], navByScheme: Map<string, number>): HarvestEvent[] {
  const now = Date.now()
  return rows.map((r) => ({
    id: crypto.randomUUID(),
    timestamp: now,
    schemeName: r.schemeName,
    unitsHarvested: r.unitsToSell,
    realizedGain: r.realizedGain,
    newCostBasis: r.unitsToSell * (navByScheme.get(r.schemeName) ?? 0),
  }))
}

export default function App() {
  const [funds, setFunds] = useState<FundRow[]>([])
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [events, setEvents] = useState<HarvestEvent[]>([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const reloadLedger = useCallback(async () => {
    setEvents(await getHarvestEvents())
  }, [])

  useEffect(() => {
    void reloadLedger()
  }, [reloadLedger])

  const fyStart = useMemo(() => getCurrentFinancialYearStartMs(), [])
  const usedThisFy = useMemo(
    () => sumRealizedGainsSince(events, fyStart),
    [events, fyStart],
  )

  const suggestions = useMemo(() => {
    return computeHarvestSuggestions(funds, included, usedThisFy)
  }, [funds, included, usedThisFy])

  const plannedGain = useMemo(
    () => suggestions.reduce((s, r) => s + r.realizedGain, 0),
    [suggestions],
  )

  const navByScheme = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of funds) m.set(f.schemeName, f.currentNav)
    return m
  }, [funds])

  const onPdf = async (file: File) => {
    setBusy(true)
    setParseError(null)
    setParseWarnings([])
    try {
      const buf = await file.arrayBuffer()
      const res = await parseCasPdf(buf)
      if (!res.ok) {
        setFunds([])
        setParseError(res.error)
        return
      }
      setFunds(res.funds)
      setParseWarnings(res.warnings)
      const inc: Record<string, boolean> = {}
      for (const f of res.funds) inc[f.schemeName] = true
      setIncluded(inc)
    } finally {
      setBusy(false)
    }
  }

  const onToggle = (schemeName: string, value: boolean) => {
    setIncluded((prev) => ({ ...prev, [schemeName]: value }))
  }

  const onSavePlan = async () => {
    if (!suggestions.length) return
    setSaving(true)
    try {
      const batch = suggestionsToEvents(suggestions, navByScheme)
      await appendHarvestEvents(batch)
      await reloadLedger()
      setToast('Logged to ledger.')
      setTimeout(() => setToast(null), 2500)
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const onExport = async () => {
    const all = await getAllStorage()
    downloadJson(`taxmukt-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`, all)
  }

  const onImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const text = await f.text()
      const data = JSON.parse(text) as unknown
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error('Backup must be a JSON object (full storage export).')
      }
      await importFullStorage(data as Record<string, unknown>)
      await reloadLedger()
      setToast('Import complete.')
      setTimeout(() => setToast(null), 2500)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <div className="min-h-full bg-lab-bg p-3 space-y-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-lab-ink">taxMuktMf</h1>
          <p className="text-xs text-lab-muted leading-snug">LTCG harvest planner · local-first</p>
        </div>
        <span className="rounded-full border border-lab-border bg-lab-surface px-2 py-0.5 text-[10px] font-medium text-lab-muted">
          ₹1.25L slab
        </span>
      </header>

      <PdfDropzone busy={busy} onFile={(f) => void onPdf(f)} />

      {busy && <p className="text-xs text-lab-muted text-center">Parsing PDF…</p>}
      {parseError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{parseError}</div>
      )}
      {parseWarnings.map((w) => (
        <div key={w} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {w}
        </div>
      ))}

      <TaxLimitBar usedThisFy={usedThisFy} plannedGain={plannedGain} />

      <FundsTable funds={funds} included={included} onToggle={onToggle} />
      <SuggestionsTable rows={suggestions} />

      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void onImportChange(e)}
      />
      <LedgerPanel
        events={events}
        onSavePlan={() => void onSavePlan()}
        saving={saving}
        canSave={suggestions.length > 0}
        onExport={() => void onExport()}
        onImportClick={() => importRef.current?.click()}
      />

      {toast && (
        <div className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-md border border-lab-border bg-lab-ink px-3 py-1.5 text-xs text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
