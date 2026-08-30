export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'
export type CardFormat = 'raw' | 'graded'

export interface CardVariant {
  id: number
  name: string
  marketPrices: Partial<Record<Condition, number>>
}

export interface CardResult {
  id: string
  name: string
  number: string
  setName: string
  setCode: string
  image?: string
  marketPrice?: number
  variants?: CardVariant[]
}

export interface InventoryLot extends CardResult {
  lotId: string
  quantity: number
  unitCost: number
  marketPriceOverride?: number
  variant?: string
  variantId?: number
  condition: Condition
  cardFormat?: CardFormat
  gradingCompany?: string
  grade?: string
  certificationNumber?: string
  notes?: string
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
  variant?: string
  cardFormat?: CardFormat
  gradingCompany?: string
  grade?: string
  certificationNumber?: string
  quantity: number
  unitPrice: number
  unitCost: number
  timestamp: string
}

export interface TradeLine {
  cardId: string
  lotId: string
  cardName: string
  cardNumber: string
  setName: string
  setCode: string
  variant: string
  condition: Condition
  cardFormat?: CardFormat
  gradingCompany?: string
  grade?: string
  certificationNumber?: string
  quantity: number
  unitTradeValue: number
  unitCost: number
  image?: string
}

export interface TradeEvent {
  id: string
  timestamp: string
  outgoing: TradeLine[]
  incoming: TradeLine[]
  cashPaid: number
  cashReceived: number
}

export interface LedgerState {
  showName: string
  showDate: string
  lots: InventoryLot[]
  transactions: Transaction[]
  trades?: TradeEvent[]
  preferences?: {
    showRealizedProfit: boolean
    showPotentialProfit: boolean
  }
}
