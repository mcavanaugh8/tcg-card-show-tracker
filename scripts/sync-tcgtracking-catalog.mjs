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
    const data = await getJson(`${API}/3/sets/${set.id}/cards`)
    for (const card of data.products ?? []) {
      if (!card.name || !card.number) continue
      catalog.push({
        id: String(card.id),
        n: card.name,
        no: String(card.number),
        sn: data.set_name ?? set.name,
        sc: data.set_abbr ?? set.abbreviation ?? '',
        img: card.image_url ?? undefined,
      })
    }
    process.stdout.write(`\rIndexed ${cursor}/${sets.length} sets`)
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
catalog.sort((a, b) => a.n.localeCompare(b.n) || a.sn.localeCompare(b.sn) || a.no.localeCompare(b.no, undefined, { numeric: true }))

await mkdir(new URL('../public/', import.meta.url), { recursive: true })
await writeFile(OUT, JSON.stringify({ source: 'TCGTracking', generatedAt: new Date().toISOString(), cards: catalog }))
console.log(`\nWrote ${catalog.length.toLocaleString()} cards to ${OUT.pathname}`)
