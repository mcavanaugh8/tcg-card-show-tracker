# Tabletop Ledger

A fast, local-first inventory and profit tracker for trading card show vendors.

## What it does

- Search TCGTracking's Pokémon catalog by card name, collector number, or both
- Record purchases as separate inventory lots with condition and cost basis
- Record sales against the exact lot they came from
- Track realized profit, revenue, cash spent, inventory value, and potential spread
- Save show data in the browser automatically
- Keep a complete activity ledger for the show

The bundled search index is generated from the public [TCGTracking Open TCG API](https://tcgtracking.com/tcgapi/). Current market prices are loaded from TCGTracking for the strongest results. A small offline fallback keeps the core workflow usable if pricing or catalog loading fails. Market prices are hints only and can be overridden on every deal.

## Run locally

```bash
npm install
npm run dev
```

Open the local address shown in the terminal. Use `npm run build` for a production build.

Refresh the bundled Pokémon catalog when needed with `npm run sync:catalog`.

## Current scope

This first version supports Pokémon cards and stores data on one device. Account sync, barcode/camera input, CSV import/export, and additional games are natural next steps.
