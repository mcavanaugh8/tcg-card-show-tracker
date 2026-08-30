export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'

export interface CardResult {
  id: string
  name: string
  number: string
  setName: string
  setCode: string
  image?: string
  marketPrice?: number
}

export interface InventoryLot extends CardResult {
  lotId: string
  quantity: number
  unitCost: number
  condition: Condition
  addedAt: string
}

export interface Transaction {
  id: string
  type: 'buy' | 'sell'
  cardId: string
  lotId: string
  cardName: string
  cardNumber: string
  setName: string
  condition: Condition
  quantity: number
  unitPrice: number
  unitCost: number
  timestamp: string
}

export interface LedgerState {
  showName: string
  showDate: string
  lots: InventoryLot[]
  transactions: Transaction[]
}
