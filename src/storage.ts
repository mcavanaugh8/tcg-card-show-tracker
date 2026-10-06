import { initialState } from './data'
import type { LedgerState, ShowLedger, WorkspaceState } from './types'

const KEY = 'tabletop-ledger-v1'
const DB_NAME = 'tabletop-ledger-backup'
const STORE_NAME = 'ledger'

function showId() {
  return globalThis.crypto?.randomUUID?.() ?? `show-${Date.now()}`
}

function migrateTradeCostBasis(state: LedgerState): LedgerState {
  if (!state.trades?.length) return state
  const basisByLot = new Map<string, number>()
  for (const transaction of state.transactions) {
    if (transaction.type === 'buy') basisByLot.set(transaction.lotId, transaction.unitCost)
  }
  for (const lot of state.lots) {
    if (!basisByLot.has(lot.lotId)) basisByLot.set(lot.lotId, lot.unitCost)
  }
  const chronological = [...state.trades].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const migratedById = new Map(chronological.map((trade) => {
    const outgoing = trade.outgoing.map((line) => ({ ...line, unitCost: basisByLot.get(line.lotId) ?? line.unitCost }))
    const outgoingBasis = outgoing.reduce((sum, line) => sum + line.quantity * line.unitCost, 0)
    const incomingValue = trade.incoming.reduce((sum, line) => sum + line.quantity * line.unitTradeValue, 0)
    const basisToCarry = Math.max(0, outgoingBasis + trade.cashPaid - trade.cashReceived)
    const incoming = trade.incoming.map((line) => {
      const lineValue = line.quantity * line.unitTradeValue
      const lineBasis = incomingValue > 0 ? basisToCarry * (lineValue / incomingValue) : basisToCarry / trade.incoming.length
      const unitCost = lineBasis / line.quantity
      basisByLot.set(line.lotId, unitCost)
      return { ...line, unitCost }
    })
    return [trade.id, { ...trade, outgoing, incoming }] as const
  }))
  return {
    ...state,
    trades: state.trades.map((trade) => migratedById.get(trade.id) ?? trade),
    lots: state.lots.map((lot) => ({ ...lot, unitCost: basisByLot.get(lot.lotId) ?? lot.unitCost })),
    transactions: state.transactions.map((transaction) => transaction.type === 'sell' && basisByLot.has(transaction.lotId) ? { ...transaction, unitCost: basisByLot.get(transaction.lotId)! } : transaction),
  }
}

function migrateWorkspace(value: LedgerState | WorkspaceState): WorkspaceState {
  if ('shows' in value && Array.isArray(value.shows)) {
    const shows = value.shows.map((show) => ({ ...migrateTradeCostBasis(show), id: show.id, createdAt: show.createdAt ?? new Date().toISOString() }))
    if (shows.length) return { activeShowId: shows.some((show) => show.id === value.activeShowId) ? value.activeShowId : shows[0].id, shows }
  }
  const ledger = migrateTradeCostBasis(value as LedgerState)
  const show: ShowLedger = { ...ledger, id: showId(), createdAt: new Date().toISOString() }
  return { activeShowId: show.id, shows: [show] }
}

function initialWorkspace(): WorkspaceState {
  const show: ShowLedger = { ...initialState, id: showId(), createdAt: new Date().toISOString() }
  return { activeShowId: show.id, shows: [show] }
}

// Read the previous browser database once so existing installations can be
// migrated into SQLite. It is no longer used as the application's database.
function openLegacyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function hasLocalState() {
  try {
    const saved = localStorage.getItem(KEY)
    if (!saved) return false
    JSON.parse(saved)
    return true
  } catch {
    return false
  }
}

export function loadCachedState(): WorkspaceState {
  try {
    const saved = localStorage.getItem(KEY)
    return saved ? migrateWorkspace(JSON.parse(saved) as LedgerState | WorkspaceState) : initialWorkspace()
  } catch {
    return initialWorkspace()
  }
}

async function loadLegacyBackup(): Promise<WorkspaceState | null> {
  try {
    const database = await openLegacyDatabase()
    const result = await new Promise<WorkspaceState | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(KEY)
      request.onsuccess = () => resolve(request.result ? migrateWorkspace(request.result as LedgerState | WorkspaceState) : null)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return result
  } catch {
    return null
  }
}

function cacheState(state: WorkspaceState) {
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* SQLite remains authoritative. */ }
}

export async function loadState(): Promise<WorkspaceState> {
  const response = await fetch('/api/state', { cache: 'no-store' })
  if (!response.ok) throw new Error('Unable to read the local SQLite database')
  const result = await response.json() as { state: WorkspaceState | null }
  if (result.state) {
    const state = migrateWorkspace(result.state)
    cacheState(state)
    return state
  }

  const legacy = hasLocalState() ? loadCachedState() : await loadLegacyBackup()
  const state = legacy ?? initialWorkspace()
  await saveState(state)
  return state
}

let saveQueue: Promise<void> = Promise.resolve()

export function saveState(state: WorkspaceState): Promise<void> {
  cacheState(state)
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    const response = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    })
    if (!response.ok) throw new Error('Unable to save to the local SQLite database')
  })
  return saveQueue
}

export async function clearSavedState() {
  await saveQueue.catch(() => undefined)
  const response = await fetch('/api/state', { method: 'DELETE' })
  if (!response.ok) throw new Error('Unable to clear the local SQLite database')
  try { localStorage.removeItem(KEY) } catch { /* The SQLite database was still cleared. */ }
}
