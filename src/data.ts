import type { CardResult, LedgerState } from './types'

export const sampleCards: CardResult[] = [
  { id: 'svp-60', name: 'Froakie', number: '060', setName: 'Scarlet & Violet Black Star Promos', setCode: 'SVP', image: 'https://images.pokemontcg.io/svp/60_hires.png', marketPrice: 3.12 },
  { id: 'sv3pt5-7', name: 'Squirtle', number: '007', setName: '151', setCode: 'MEW', image: 'https://images.pokemontcg.io/sv3pt5/7_hires.png', marketPrice: 0.21 },
  { id: 'sv3pt5-199', name: 'Charizard ex', number: '199', setName: '151', setCode: 'MEW', image: 'https://images.pokemontcg.io/sv3pt5/199_hires.png', marketPrice: 184.46 },
  { id: 'sv4-251', name: 'Iron Valiant ex', number: '251', setName: 'Paradox Rift', setCode: 'PAR', image: 'https://images.pokemontcg.io/sv4/251_hires.png', marketPrice: 19.76 },
  { id: 'swsh7-215', name: 'Umbreon VMAX', number: '215', setName: 'Evolving Skies', setCode: 'EVS', image: 'https://images.pokemontcg.io/swsh7/215_hires.png', marketPrice: 1288.9 },
]

const now = new Date()
const today = now.toISOString().slice(0, 10)

export const initialState: LedgerState = {
  showName: 'Weekend Card Show',
  showDate: today,
  lots: [
    { ...sampleCards[2], lotId: 'lot-charizard', quantity: 2, unitCost: 142, condition: 'NM', addedAt: now.toISOString() },
    { ...sampleCards[3], lotId: 'lot-iron', quantity: 4, unitCost: 14.5, condition: 'NM', addedAt: now.toISOString() },
    { ...sampleCards[1], lotId: 'lot-squirtle', quantity: 12, unitCost: 0.1, condition: 'NM', addedAt: now.toISOString() },
  ],
  transactions: [],
}
