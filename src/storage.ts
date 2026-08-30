import { initialState } from './data'
import type { LedgerState } from './types'

const KEY = 'tabletop-ledger-v1'
const DB_NAME = 'tabletop-ledger-backup'
const STORE_NAME = 'ledger'

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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function writeBackup(state: LedgerState) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(state, KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
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

export function loadState(): LedgerState {
  try {
    const saved = localStorage.getItem(KEY)
    return saved ? migrateTradeCostBasis(JSON.parse(saved) as LedgerState) : initialState
  } catch {
    return initialState
  }
}

export async function loadBackupState(): Promise<LedgerState | null> {
  try {
    const database = await openDatabase()
    const result = await new Promise<LedgerState | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(KEY)
      request.onsuccess = () => resolve(request.result ? migrateTradeCostBasis(request.result as LedgerState) : null)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return result
  } catch {
    return null
  }
}

export function saveState(state: LedgerState) {
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* IndexedDB remains available. */ }
  void writeBackup(state).catch(() => undefined)
}

export async function clearSavedState() {
  try { localStorage.removeItem(KEY) } catch { /* Continue clearing the backup. */ }
  try {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  } catch { /* Both stores are best-effort device-local persistence. */ }
}
