import { initialState } from './data'
import type { LedgerState } from './types'

const KEY = 'tabletop-ledger-v1'

export function loadState(): LedgerState {
  try {
    const saved = localStorage.getItem(KEY)
    return saved ? (JSON.parse(saved) as LedgerState) : initialState
  } catch {
    return initialState
  }
}

export function saveState(state: LedgerState) {
  localStorage.setItem(KEY, JSON.stringify(state))
}
