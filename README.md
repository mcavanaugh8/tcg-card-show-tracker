# Tabletop Ledger

A fast, local-first inventory and profit tracker for trading card show vendors.

## What it does

- Search TCGTracking's Pokémon catalog for singles and sealed products by name, collector number, or both
- Buy, sell, inventory, and trade sealed products such as booster boxes, packs, Elite Trainer Boxes, and bundles
- Record purchases as separate inventory lots with condition and cost basis
- Keep Normal, Holofoil, Reverse Holofoil, and other print variants as distinct lots
- Use condition-specific TCGTracking SKU market prices when available
- Track graded slabs by grader, grade, certification number, notes, and manual market value
- Record multi-card trades with cards and cash on either side, negotiated values, and realized profit
- Use global search, recent cards, market-percentage price presets, keyboard shortcuts, and one-click undo for fast show-floor entry
- Record sales against the exact lot they came from
- Track realized profit, revenue, cash spent, inventory value, and potential spread
- Install the app on a phone, tablet, or computer and use its interface and complete bundled catalog offline
- Save show data in the browser automatically
- Keep a second device-local IndexedDB backup for recovery
- Export inventory and transaction history together as CSV
- Keep a complete activity ledger for the show

The bundled search index is generated from the public [TCGTracking Open TCG API](https://tcgtracking.com/tcgapi/) and currently contains 27,992 cards plus 2,924 sealed products. The production app precaches that complete index for offline search. Current market prices and product images are loaded from TCGTracking when connected; previously viewed details and images are cached. Market prices are hints only and can be overridden on every deal.

## Run locally

```bash
npm install
npm run dev
```

Open the local address shown in the terminal. Use `npm run build` for a production build.

Refresh the bundled Pokémon catalog when needed with `npm run sync:catalog`.

## Current scope

This version supports Pokémon singles, graded cards, and sealed products, and stores data on one device. Account sync, barcode/camera input, CSV import, and additional games are natural next steps.
