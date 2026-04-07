import type { FundRow } from '../types'
import { parseIndianNumber } from './numbers'

type PdfJsModule = typeof import('pdfjs-dist')

export type ParsePdfResult =
  | { ok: true; funds: FundRow[]; warnings: string[] }
  | { ok: false; error: string }

function normalizeSchemeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}

function normKey(name: string): string {
  return normalizeSchemeName(name).toLowerCase()
}

/** Reconstruct reading-order lines from PDF text items (by Y, then X). */
async function pdfToLines(pdfjs: PdfJsModule, data: Uint8Array): Promise<string[]> {
  const loading = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
  })
  const pdf = await loading.promise
  const lineBuckets = new Map<number, { x: number; s: string }[]>()
  const yTol = 3

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    for (const raw of content.items) {
      const item = raw as { str?: string; transform: number[] }
      if (!item.str?.trim()) continue
      const t = item.transform
      const x = t[4]
      const y = t[5]
      const yKey = Math.round(y / yTol) * yTol
      const row = lineBuckets.get(yKey) ?? []
      row.push({ x, s: item.str })
      lineBuckets.set(yKey, row)
    }
  }

  const sortedY = [...lineBuckets.keys()].sort((a, b) => b - a)
  const lines: string[] = []
  for (const yKey of sortedY) {
    const row = lineBuckets.get(yKey)!
    row.sort((a, b) => a.x - b.x)
    const line = row.map((r) => r.s).join(' ').replace(/\s+/g, ' ').trim()
    if (line) lines.push(line)
  }
  return lines
}

function sliceSection(lines: string[], startIdx: number, endIdx: number): string[] {
  return lines.slice(startIdx, endIdx)
}

function findSectionIndices(lines: string[]): { s3: [number, number]; s5: [number, number] } {
  const re3 = /^(?:section\s*3|3[\.\)]\s+)/i
  const re5 = /^(?:section\s*5|5[\.\)]\s+)/i
  let i3 = -1
  let i5 = -1
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]
    if (i3 < 0 && re3.test(L)) i3 = i
    else if (i5 < 0 && re5.test(L)) i5 = i
  }
  if (i3 < 0) i3 = 0
  if (i5 < 0) i5 = Math.min(lines.length, i3 + 1)
  const s3End = i5 > i3 ? i5 : lines.length
  const s5End = lines.length
  return {
    s3: [i3, s3End],
    s5: [Math.max(i5, i3), s5End],
  }
}

type S3Row = {
  name: string
  currentNav: number
  /** Cost / average NAV if present */
  avgNav: number
  totalUnits?: number
  appreciation?: number
}

type S5Row = {
  name: string
  stcgUnits: number
  ltcgUnits: number
}

const ISIN_RE = /\b([A-Z]{2}[0-9A-Z]{9}[0-9])\b/

/**
 * Section 3: valuation — extract scheme rows with NAV and appreciation hints.
 * Heuristic: line contains ISIN or ends with multiple numeric tokens (units, nav, value, gain…).
 */
function parseSection3(lines: string[]): Map<string, S3Row> {
  const map = new Map<string, S3Row>()
  for (const line of lines) {
    const nums = [...line.matchAll(/[+-]?[\d,]+\.?\d*/g)].map((m) => parseIndianNumber(m[0]))
    const finite = nums.filter((n) => Number.isFinite(n))
    if (finite.length < 2) continue

    let namePart = line
    const isin = line.match(ISIN_RE)
    if (isin) {
      namePart = line.slice(0, line.indexOf(isin[0]) + isin[0].length).trim()
    } else {
      // Strip trailing numeric run for name
      const lastNum = [...line.matchAll(/[+-]?[\d,]+\.?\d*/g)].pop()
      if (lastNum && typeof lastNum.index === 'number') {
        namePart = line.slice(0, lastNum.index).trim()
      }
    }

    if (namePart.length < 6) continue
    if (/^section\b/i.test(namePart)) continue
    if (/^folio\b/i.test(namePart)) continue

    const name = normalizeSchemeName(namePart.replace(ISIN_RE, '').trim())
    if (name.length < 4) continue

    const tail = finite.slice(-4)
    let currentNav = tail[tail.length - 2] ?? tail[tail.length - 1]
    let avgNav = tail[0] ?? NaN
    let appreciation: number | undefined

    // Typical order: units, nav, value, cost, gain — varies by RTA
    if (finite.length >= 3) {
      const maybeNav = finite[finite.length - 3]
      if (maybeNav > 1 && maybeNav < 1_000_000) currentNav = finite[finite.length - 2] ?? currentNav
    }

    // If last number looks like currency gain (large) and previous small like NAV
    const last = finite[finite.length - 1]
    const secondLast = finite[finite.length - 2]
    if (last > 10_000 && secondLast > 0 && secondLast < 5000) {
      appreciation = last
      currentNav = secondLast
      avgNav = finite[finite.length - 3] > 0 && finite[finite.length - 3] < secondLast
        ? finite[finite.length - 3]
        : secondLast * 0.85
    }

    if (!Number.isFinite(avgNav) || avgNav <= 0) {
      avgNav = currentNav > 0 ? currentNav * 0.9 : NaN
    }
    if (!Number.isFinite(currentNav) || currentNav <= 0) continue

    const key = normKey(name)
    const prev = map.get(key)
    const row: S3Row = {
      name,
      currentNav,
      avgNav: Number.isFinite(avgNav) && avgNav > 0 ? avgNav : currentNav * 0.9,
      appreciation,
    }
    if (!prev || (appreciation ?? 0) >= (prev.appreciation ?? 0)) map.set(key, row)
  }
  return map
}

/**
 * Section 5: aging — map STCG (0–365d) and LTCG (>365d) units.
 * Looks for bucket keywords on same or adjacent lines as scheme names.
 */
function parseSection5(lines: string[]): Map<string, S5Row> {
  const map = new Map<string, S5Row>()
  const stcgRe = /(?:0\s*[-–]\s*365|0\s*to\s*365|<=\s*365|short\s*term|stcg)/i
  const ltcgRe = /(?:>\s*365|366|long\s*term|ltcg|>\s*12\s*months)/i

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const window = [line, lines[i + 1] ?? '', lines[i + 2] ?? ''].join(' ')
    const nums = [...window.matchAll(/[+-]?[\d,]+\.?\d*/g)].map((m) => parseIndianNumber(m[0]))
    const finite = nums.filter((n) => Number.isFinite(n) && n >= 0)
    if (finite.length < 1) continue

    let namePart = line
    const isin = line.match(ISIN_RE)
    if (isin) namePart = line.slice(0, line.indexOf(isin[1]) + isin[1].length)
    namePart = normalizeSchemeName(namePart.replace(ISIN_RE, '').trim())
    if (namePart.length < 4 || /^section\b/i.test(namePart)) continue

    let stcgUnits = 0
    let ltcgUnits = 0

    if (stcgRe.test(window) && ltcgRe.test(window)) {
      const small = finite.filter((n) => n > 0 && n < 1e9)
      if (small.length >= 2) {
        stcgUnits = small[0]!
        ltcgUnits = small[1]!
      } else if (small.length === 1) {
        if (stcgRe.test(line)) stcgUnits = small[0]!
        else ltcgUnits = small[0]!
      }
    } else if (stcgRe.test(line)) {
      const u = finite.find((n) => n > 0 && n < 1e7)
      if (u !== undefined) stcgUnits = u
    } else if (ltcgRe.test(line)) {
      const u = finite.find((n) => n > 0 && n < 1e7)
      if (u !== undefined) ltcgUnits = u
    } else {
      // Table row: scheme ... stcgUnits ltcgUnits
      const unitLike = finite.filter((n) => n > 0 && n < 1e8)
      if (unitLike.length >= 2) {
        stcgUnits = unitLike[0]!
        ltcgUnits = unitLike[1]!
      } else continue
    }

    const key = normKey(namePart)
    const prev = map.get(key)
    const row: S5Row = { name: namePart, stcgUnits, ltcgUnits }
    if (!prev || stcgUnits + ltcgUnits >= prev.stcgUnits + prev.ltcgUnits) map.set(key, row)
  }
  return map
}

function mergeMaps(s3: Map<string, S3Row>, s5: Map<string, S5Row>): FundRow[] {
  const keys = new Set([...s3.keys(), ...s5.keys()])
  const out: FundRow[] = []
  for (const key of keys) {
    const a = s3.get(key)
    const b = s5.get(key)
    const name = a?.name ?? b?.name ?? key
    const currentNav = a?.currentNav ?? 0
    const avgNav = a?.avgNav ?? (currentNav > 0 ? currentNav * 0.9 : 0)
    const stcgUnits = b?.stcgUnits ?? 0
    const ltcgUnits = b?.ltcgUnits ?? 0
    if (!currentNav && !stcgUnits && !ltcgUnits) continue
    out.push({
      schemeName: name,
      ltcgUnits,
      stcgUnits,
      avgNav: avgNav || currentNav,
      currentNav: currentNav || avgNav,
    })
  }
  return out.sort((x, y) => x.schemeName.localeCompare(y.schemeName))
}

export async function parseCasPdf(buffer: ArrayBuffer): Promise<ParsePdfResult> {
  const warnings: string[] = []
  try {
    const pdfjs = await import('pdfjs-dist')
    const workerMod = await import('pdfjs-dist/build/pdf.worker.min.js?url')
    pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default

    const data = new Uint8Array(buffer)
    const lines = await pdfToLines(pdfjs, data)
    if (!lines.length) return { ok: false, error: 'No text found in PDF (try a text-based CAS, not a scan).' }

    const { s3: [a3, b3], s5: [a5, b5] } = findSectionIndices(lines)
    const sec3 = sliceSection(lines, a3, b3)
    const sec5 = sliceSection(lines, a5, b5)

    if (sec3.length < 2) warnings.push('Section 3 header not found; valuation parse may be weak.')
    if (sec5.length < 2) warnings.push('Section 5 header not found; aging buckets may be incomplete.')

    const m3 = parseSection3(sec3)
    const m5 = parseSection5(sec5)
    if (!m3.size && !m5.size) {
      return {
        ok: false,
        error:
          'Could not parse scheme rows. Ensure the PDF is a CAMS/KFin/NSE CAS with Section 3 & 5 labels.',
      }
    }
    if (!m5.size) warnings.push('No Section 5 unit buckets parsed; LTCG/STCG units may default to 0.')
    if (!m3.size) warnings.push('No Section 3 rows parsed; NAV/averages may be estimated from Section 5 only.')

    const funds = mergeMaps(m3, m5)
    return { ok: true, funds, warnings }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}
