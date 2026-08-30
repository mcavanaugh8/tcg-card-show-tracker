import { mkdir, writeFile } from 'node:fs/promises'

const API = 'https://tcgtracking.com/tcgapi/v1'
const OUT = new URL('../public/pokemon-catalog.json', import.meta.url)
const CONCURRENCY = 12

async function getJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json()
}

const setData = await getJson(`${API}/3/sets`)
const sets = setData.sets.filter((set) => set.product_count > 0)
let cursor = 0
const catalog = []

async function worker() {
  while (cursor < sets.length) {
    const set = sets[cursor++]
    const [data, sealedData] = await Promise.all([
      getJson(`${API}/3/sets/${set.id}/cards`),
      getJson(`${API}/3/sets/${set.id}/sealed`),
    ])
    for (const card of data.products ?? []) {
      if (!card.name || !card.number) continue
      catalog.push({
        id: String(card.id),
        n: card.name,
        no: String(card.number),
        sn: data.set_name ?? set.name,
        sc: data.set_abbr ?? set.abbreviation ?? '',
        img: card.image_url ?? undefined,
        t: 'card',
      })
    }
    for (const product of sealedData.products ?? []) {
      if (!product.name) continue
      catalog.push({
        id: String(product.id),
        n: product.name,
        no: '',
        sn: sealedData.set_name ?? set.name,
        sc: sealedData.set_abbr ?? set.abbreviation ?? '',
        img: product.image_url ?? undefined,
        t: 'sealed',
      })
    }
    process.stdout.write(`\rIndexed ${cursor}/${sets.length} sets`)
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
catalog.sort((a, b) => a.n.localeCompare(b.n) || a.sn.localeCompare(b.sn) || a.no.localeCompare(b.no, undefined, { numeric: true }))

await mkdir(new URL('../public/', import.meta.url), { recursive: true })
await writeFile(OUT, JSON.stringify({ source: 'TCGTracking', generatedAt: new Date().toISOString(), cards: catalog }))
const sealedCount = catalog.filter((product) => product.t === 'sealed').length
console.log(`\nWrote ${(catalog.length - sealedCount).toLocaleString()} cards and ${sealedCount.toLocaleString()} sealed products to ${OUT.pathname}`)
