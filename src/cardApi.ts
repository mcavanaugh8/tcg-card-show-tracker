import { sampleCards } from './data'
import type { CardResult } from './types'

const API_URL = 'https://tcgtracking.com/tcgapi/v1'

type CatalogCard = { id: string; n: string; no: string; sn: string; sc: string; img?: string }
type CatalogPayload = { source: string; generatedAt: string; cards: CatalogCard[] }
type ProductPayload = {
  product?: { market_price?: string | null }
  prices?: { tcgplayer?: Array<{ market_price?: string | null; sub_type_name?: string }> }
}

let catalogPromise: Promise<CatalogCard[]> | undefined
const priceCache = new Map<string, number | undefined>()

const normalize = (value: string) => value.toLowerCase().replace(/^#?0+/, '')
const tokens = (value: string) => value.toLowerCase().trim().split(/\s+/).filter(Boolean)

function getCatalog(signal?: AbortSignal) {
  catalogPromise ??= fetch('/pokemon-catalog.json', { signal })
    .then((response) => {
      if (!response.ok) throw new Error('Card catalog is unavailable')
      return response.json() as Promise<CatalogPayload>
    })
    .then((payload) => payload.cards)
    .catch((error) => {
      catalogPromise = undefined
      throw error
    })
  return catalogPromise
}

function score(card: CatalogCard, term: string, searchTokens: string[]) {
  const name = card.n.toLowerCase()
  const number = normalize(card.no)
  const cleanTerm = term.toLowerCase().trim()
  let value = 0
  if (name === cleanTerm) value += 100
  if (name.startsWith(cleanTerm)) value += 50
  if (searchTokens.some((token) => normalize(token) === number)) value += 40
  if (name.includes(cleanTerm)) value += 20
  return value
}

function mapCard(card: CatalogCard, marketPrice?: number): CardResult {
  return { id: card.id, name: card.n, number: card.no, setName: card.sn, setCode: card.sc, image: card.img, marketPrice }
}

async function getMarketPrice(productId: string, signal?: AbortSignal) {
  if (priceCache.has(productId)) return priceCache.get(productId)
  try {
    const response = await fetch(`${API_URL}/products/${productId}`, { signal })
    if (!response.ok) return undefined
    const payload = (await response.json()) as ProductPayload
    const variants = payload.prices?.tcgplayer ?? []
    const preferred = variants.find((price) => /normal|holofoil/i.test(price.sub_type_name ?? '') && price.market_price)
      ?? variants.find((price) => price.market_price)
    const raw = preferred?.market_price ?? payload.product?.market_price
    const price = raw == null ? undefined : Number(raw)
    const validPrice = Number.isFinite(price) ? price : undefined
    priceCache.set(productId, validPrice)
    return validPrice
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    return undefined
  }
}

export function localSearch(term: string): CardResult[] {
  const words = tokens(term)
  if (!words.length) return sampleCards
  return sampleCards.filter((card) => {
    const haystack = `${card.name} ${card.number} ${card.setName} ${card.setCode}`.toLowerCase()
    return words.every((word) => haystack.includes(word) || normalize(card.number) === normalize(word))
  })
}

export async function searchCards(term: string, signal?: AbortSignal): Promise<CardResult[]> {
  const clean = term.trim()
  if (!clean) return sampleCards
  const words = tokens(clean)
  const catalog = await getCatalog(signal)
  const matches = catalog
    .filter((card) => {
      const haystack = `${card.n} ${card.no} ${card.sn} ${card.sc}`.toLowerCase()
      return words.every((word) => haystack.includes(word) || normalize(card.no) === normalize(word))
    })
    .map((card, index) => ({ card, index, score: score(card, clean, words) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 24)

  return Promise.all(matches.map(async ({ card }, index) => {
    const marketPrice = index < 8 ? await getMarketPrice(card.id, signal) : undefined
    return mapCard(card, marketPrice)
  }))
}
