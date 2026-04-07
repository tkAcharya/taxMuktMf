import type { HarvestEvent } from '../types'
import { STORAGE_KEYS } from '../types'

const LOCAL_KEY = 'taxmukt_mf_shadow_storage'

function isChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local
}

export async function getAllStorage(): Promise<Record<string, unknown>> {
  if (isChromeStorage()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(null, (obj) => {
        const err = chrome.runtime?.lastError
        if (err) reject(new Error(err.message))
        else resolve(obj as Record<string, unknown>)
      })
    })
  }
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function setStoragePatch(patch: Record<string, unknown>): Promise<void> {
  if (isChromeStorage()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(patch, () => {
        const err = chrome.runtime?.lastError
        if (err) reject(new Error(err.message))
        else resolve()
      })
    })
  }
  const cur = await getAllStorage()
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...cur, ...patch }))
}

export async function getHarvestEvents(): Promise<HarvestEvent[]> {
  const all = await getAllStorage()
  const raw = all[STORAGE_KEYS.harvestEvents]
  if (!Array.isArray(raw)) return []
  return raw as HarvestEvent[]
}

export async function appendHarvestEvents(events: HarvestEvent[]): Promise<void> {
  const prev = await getHarvestEvents()
  await setStoragePatch({ [STORAGE_KEYS.harvestEvents]: [...prev, ...events] })
}

export async function replaceHarvestEvents(events: HarvestEvent[]): Promise<void> {
  await setStoragePatch({ [STORAGE_KEYS.harvestEvents]: events })
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Replaces extension local storage with an exported backup object. */
export async function importFullStorage(data: Record<string, unknown>): Promise<void> {
  if (isChromeStorage()) {
    await new Promise<void>((resolve, reject) => {
      chrome.storage.local.clear(() => {
        const e1 = chrome.runtime?.lastError
        if (e1) {
          reject(new Error(e1.message))
          return
        }
        chrome.storage.local.set(data, () => {
          const e2 = chrome.runtime?.lastError
          if (e2) reject(new Error(e2.message))
          else resolve()
        })
      })
    })
    return
  }
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data))
}
