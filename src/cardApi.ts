import { sampleCards } from './data'
import type { CardResult, CardVariant, Condition } from './types'

const API_URL = 'https://tcgtracking.com/tcgapi/v1'

type CatalogCard = { id: string; n: string; no: string; sn: string; sc: string; img?: string }
type CatalogPayload = { source: string; generatedAt: string; cards: CatalogCard[] }
type ProductPayload = {
  product?: { market_price?: string | null }
  prices?: { tcgplayer?: Array<{ market_price?: string | null; sub_type_name?: string }> }
  sku_dimensions?: { variants?: Array<{ id: number; name: string }> }
  skus?: Array<{
    condition_name?: string
    variant_name?: string
    variant_id?: number
    language_name?: string
    market_price?: string | null
  }>
}

let catalogPromise: Promise<CatalogCard[]> | undefined
const detailsCache = new Map<string, Promise<{ marketPrice?: number; variants: CardVariant[] }>>()
const conditionCodes: Record<string, Condition> = {
  'Near Mint': 'NM',
  'Lightly Played': 'LP',
  'Moderately Played': 'MP',
  'Heavily Played': 'HP',
  Damaged: 'DMG',
}

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

function mapCard(card: CatalogCard, details?: { marketPrice?: number; variants: CardVariant[] }): CardResult {
  return { id: card.id, name: card.n, number: card.no, setName: card.sn, setCode: card.sc, image: card.img, marketPrice: details?.marketPrice, variants: details?.variants }
}

async function getProductDetails(productId: string, signal?: AbortSignal) {
  if (!detailsCache.has(productId)) detailsCache.set(productId, (async () => {
    const response = await fetch(`${API_URL}/products/${productId}`, { signal })
    if (!response.ok) return { marketPrice: undefined, variants: [] }
    const payload = (await response.json()) as ProductPayload
    const prices = payload.prices?.tcgplayer ?? []
    const preferred = prices.find((price) => /normal|holofoil/i.test(price.sub_type_name ?? '') && price.market_price)
      ?? prices.find((price) => price.market_price)
    const raw = preferred?.market_price ?? payload.product?.market_price
    const price = raw == null ? undefined : Number(raw)
    const variants = (payload.sku_dimensions?.variants ?? []).map((variant) => {
      const marketPrices: Partial<Record<Condition, number>> = {}
      for (const sku of payload.skus ?? []) {
        if (sku.variant_id !== variant.id || sku.language_name !== 'English' || !sku.market_price) continue
        const condition = conditionCodes[sku.condition_name ?? '']
        const marketPrice = Number(sku.market_price)
        if (condition && Number.isFinite(marketPrice)) marketPrices[condition] = marketPrice
      }
      return { id: variant.id, name: variant.name, marketPrices }
    })
    return { marketPrice: Number.isFinite(price) ? price : undefined, variants }
  })().catch((error) => {
    detailsCache.delete(productId)
    throw error
  }))
  return detailsCache.get(productId)!
}

export async function hydrateCard(card: CardResult, signal?: AbortSignal): Promise<CardResult> {
  if (card.variants?.length) return card
  try {
    const details = await getProductDetails(card.id, signal)
    return { ...card, marketPrice: details.marketPrice ?? card.marketPrice, variants: details.variants }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    return card
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
    let details: { marketPrice?: number; variants: CardVariant[] } | undefined
    if (index < 8) {
      try { details = await getProductDetails(card.id, signal) }
      catch (error) { if ((error as Error).name === 'AbortError') throw error }
    }
    return mapCard(card, details)
  }))
}
