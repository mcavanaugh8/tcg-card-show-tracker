import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownLeft, ArrowUpRight, BarChart3, Box, Check, ChevronDown, CircleDollarSign,
  Database, Download, Eye, EyeOff, Handshake, Menu, Minus, PackageOpen, Pencil, Plus,
  RotateCcw, Search, Settings, ShoppingBag, Sparkles, Trash2, Undo2, X,
} from 'lucide-react'
import { hydrateCard, localSearch, searchCards } from './cardApi'
import { exportLedgerCsv } from './exportCsv'
import { clearSavedState, hasLocalState, loadBackupState, loadState, saveState } from './storage'
import type { CardFormat, CardResult, CardVariant, Condition, InventoryLot, LedgerState, ShowLedger, TradeEvent, TradeLine, Transaction, WorkspaceState } from './types'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const conditions: Condition[] = ['NM', 'LP', 'MP', 'HP', 'DMG']
const gradingCompanies = ['PSA', 'CGC', 'BGS', 'SGC', 'ACE', 'Other']
const effectiveMarketPrice = (lot: InventoryLot) => lot.marketPriceOverride ?? lot.marketPrice
const lotDescriptor = (lot: Pick<InventoryLot, 'productType' | 'cardFormat' | 'gradingCompany' | 'grade' | 'condition'>) => lot.productType === 'sealed' ? 'Sealed' : lot.cardFormat === 'graded' ? `${lot.gradingCompany ?? 'Graded'} ${lot.grade ?? ''}`.trim() : lot.condition
const productNumber = (product: Pick<CardResult, 'number'>) => product.number ? ` · #${product.number}` : ''
const productVariant = (product: Pick<InventoryLot, 'productType' | 'variant'>) => product.productType === 'sealed' ? 'Sealed product' : product.variant ?? 'Unspecified'
type PurchaseDetails = { format: CardFormat; gradingCompany?: string; grade?: string; certificationNumber?: string; notes?: string; gradedMarketValue?: number }

type Flow = 'buy' | 'sell'
type Stats = { units: number; cost: number; market: number; potential: number; revenue: number; profit: number; buys: number }

function App() {
  const [hadLocalState] = useState(hasLocalState)
  const [workspace, setWorkspace] = useState<WorkspaceState>(loadState)
  const [storageReady, setStorageReady] = useState(hadLocalState)
  const [tab, setTab] = useState<'overview' | 'inventory' | 'activity'>('overview')
  const [flow, setFlow] = useState<Flow | null>(null)
  const [buyCard, setBuyCard] = useState<CardResult | null>(null)
  const [saleLot, setSaleLot] = useState<InventoryLot | null>(null)
  const [editingLot, setEditingLot] = useState<InventoryLot | null>(null)
  const [inventoryFilter, setInventoryFilter] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tradeOpen, setTradeOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [undoEntry, setUndoEntry] = useState<{ snapshot: LedgerState; label: string } | null>(null)

  useEffect(() => {
    if (hadLocalState) return
    let active = true
    void loadBackupState().then((backup) => {
      if (active && backup) setWorkspace(backup)
    }).finally(() => {
      if (active) setStorageReady(true)
    })
    return () => { active = false }
  }, [hadLocalState])

  useEffect(() => {
    if (storageReady) saveState(workspace)
  }, [workspace, storageReady])

  const state = workspace.shows.find((show) => show.id === workspace.activeShowId) ?? workspace.shows[0]

  function setState(next: LedgerState | ((current: ShowLedger) => LedgerState)) {
    setWorkspace((current) => ({
      ...current,
      shows: current.shows.map((show) => show.id === current.activeShowId
        ? { ...(typeof next === 'function' ? next(show) : next), id: show.id, createdAt: show.createdAt }
        : show),
    }))
  }

  useEffect(() => {
    if (!undoEntry) return
    const timer = window.setTimeout(() => setUndoEntry(null), 7000)
    return () => window.clearTimeout(timer)
  }, [undoEntry])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      const typing = target.matches('input, textarea, select, [contenteditable="true"]')
      if (event.key === 'Escape') {
        setFlow(null); setBuyCard(null); setSaleLot(null); setTradeOpen(false); setGlobalSearchOpen(false); setEditingLot(null); setSettingsOpen(false)
        return
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey || flow || tradeOpen || globalSearchOpen || editingLot || settingsOpen) return
      if (event.key === '/') { event.preventDefault(); setGlobalSearchOpen(true) }
      if (event.key.toLowerCase() === 'b') startBuy()
      if (event.key.toLowerCase() === 's') startSale()
      if (event.key.toLowerCase() === 't') setTradeOpen(true)
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [editingLot, flow, globalSearchOpen, settingsOpen, tradeOpen])

  const stats = useMemo(() => {
    const units = state.lots.reduce((sum, lot) => sum + lot.quantity, 0)
    const cost = state.lots.reduce((sum, lot) => sum + lot.quantity * lot.unitCost, 0)
    const market = state.lots.reduce((sum, lot) => sum + lot.quantity * (effectiveMarketPrice(lot) ?? lot.unitCost), 0)
    const sales = state.transactions.filter((tx) => tx.type === 'sell')
    const trades = state.trades ?? []
    const revenue = sales.reduce((sum, tx) => sum + tx.quantity * tx.unitPrice, 0) + trades.reduce((sum, trade) => sum + trade.cashReceived, 0)
    const profit = sales.reduce((sum, tx) => sum + tx.quantity * (tx.unitPrice - tx.unitCost), 0) + trades.reduce((sum, trade) => {
      const outgoingBasis = trade.outgoing.reduce((lineSum, line) => lineSum + line.quantity * line.unitCost, 0)
      return sum + Math.max(0, trade.cashReceived - outgoingBasis - trade.cashPaid)
    }, 0)
    const buys = state.transactions.filter((tx) => tx.type === 'buy').reduce((sum, tx) => sum + tx.quantity * tx.unitPrice, 0) + trades.reduce((sum, trade) => sum + trade.cashPaid, 0)
    return { units, cost, market, potential: market - cost, revenue, profit, buys }
  }, [state])

  const filteredLots = state.lots.filter((lot) => `${lot.name} ${lot.number} ${lot.setName} ${lot.variant ?? ''}`.toLowerCase().includes(inventoryFilter.toLowerCase()))
  const recentCards = useMemo(() => {
    const seen = new Set<string>()
    return [...state.lots].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).filter((lot) => !seen.has(lot.id) && Boolean(seen.add(lot.id))).slice(0, 5)
  }, [state.lots])

  function commitChange(label: string, next: LedgerState) {
    setUndoEntry({ snapshot: state, label })
    setState(next)
  }

  function recordBuy(card: CardResult, quantity: number, unitCost: number, condition: Condition, variant?: CardVariant, details?: PurchaseDetails) {
    const lotId = crypto.randomUUID()
    const timestamp = new Date().toISOString()
    const marketPrice = variant?.marketPrices[condition] ?? card.marketPrice
    const cardFormat = card.productType === 'sealed' ? 'raw' : details?.format ?? 'raw'
    const lot: InventoryLot = { ...card, marketPrice, marketPriceOverride: cardFormat === 'graded' ? details?.gradedMarketValue : undefined, variant: card.productType === 'sealed' ? 'Sealed product' : variant?.name ?? 'Unspecified', variantId: variant?.id, lotId, quantity, unitCost, condition, cardFormat, gradingCompany: details?.gradingCompany, grade: details?.grade, certificationNumber: details?.certificationNumber, notes: details?.notes, addedAt: timestamp }
    const tx: Transaction = { id: crypto.randomUUID(), type: 'buy', cardId: card.id, lotId, cardName: card.name, cardNumber: card.number, setName: card.setName, condition, variant: lot.variant, cardFormat, gradingCompany: lot.gradingCompany, grade: lot.grade, certificationNumber: lot.certificationNumber, productType: card.productType ?? 'card', quantity, unitPrice: unitCost, unitCost, timestamp }
    commitChange(`Bought ${quantity}× ${card.name}`, { ...state, lots: [lot, ...state.lots], transactions: [tx, ...state.transactions] })
  }

  function recordSale(lot: InventoryLot, quantity: number, unitPrice: number) {
    const tx: Transaction = { id: crypto.randomUUID(), type: 'sell', cardId: lot.id, lotId: lot.lotId, cardName: lot.name, cardNumber: lot.number, setName: lot.setName, condition: lot.condition, variant: lot.variant ?? 'Unspecified', cardFormat: lot.cardFormat ?? 'raw', gradingCompany: lot.gradingCompany, grade: lot.grade, certificationNumber: lot.certificationNumber, productType: lot.productType ?? 'card', quantity, unitPrice, unitCost: lot.unitCost, timestamp: new Date().toISOString() }
    commitChange(`Sold ${quantity}× ${lot.name}`, { ...state, lots: state.lots.map((item) => item.lotId === lot.lotId ? { ...item, quantity: item.quantity - quantity } : item).filter((item) => item.quantity > 0), transactions: [tx, ...state.transactions] })
  }

  function startBuy(card?: CardResult) {
    setBuyCard(card ?? null)
    setFlow('buy')
  }

  function startSale(lot?: InventoryLot) {
    setSaleLot(lot ?? null)
    setFlow('sell')
  }

  function closeTransaction() {
    setFlow(null)
    setBuyCard(null)
    setSaleLot(null)
  }

  function removeLot(lot: InventoryLot) {
    const label = `${lot.quantity}× ${lot.name} #${lot.number}`
    if (!window.confirm(`Remove ${label} from inventory?\n\nThis will not create a transaction or change your profit history.`)) return
    commitChange(`Removed ${lot.name}`, { ...state, lots: state.lots.filter((item) => item.lotId !== lot.lotId) })
  }

  function updateLotPricing(lotId: string, unitCost: number, marketPriceOverride?: number) {
    commitChange('Updated inventory pricing', { ...state, lots: state.lots.map((lot) => lot.lotId === lotId ? { ...lot, unitCost, marketPriceOverride } : lot) })
    setEditingLot(null)
  }

  function recordTrade(trade: TradeEvent, incomingLots: InventoryLot[]) {
    const outgoingQuantities = new Map(trade.outgoing.map((line) => [line.lotId, line.quantity]))
    commitChange('Recorded trade', { ...state, lots: [...incomingLots, ...state.lots.map((lot) => ({ ...lot, quantity: lot.quantity - (outgoingQuantities.get(lot.lotId) ?? 0) })).filter((lot) => lot.quantity > 0)], trades: [trade, ...(state.trades ?? [])] })
    setTradeOpen(false)
  }

  function updateShow(showName: string, showDate: string) {
    setState((current) => ({ ...current, showName, showDate }))
  }

  function createShow(showName: string, showDate: string, carryInventory: boolean) {
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const show: ShowLedger = {
      id,
      createdAt,
      showName: showName.trim() || 'Untitled Show',
      showDate,
      lots: carryInventory ? state.lots.map((lot) => ({ ...lot })) : [],
      transactions: [],
      trades: [],
      preferences: state.preferences,
    }
    setWorkspace((current) => ({ activeShowId: id, shows: [show, ...current.shows] }))
    setUndoEntry(null)
    setTab('overview')
  }

  function switchShow(id: string) {
    if (!workspace.shows.some((show) => show.id === id)) return
    setWorkspace((current) => ({ ...current, activeShowId: id }))
    setUndoEntry(null)
    setInventoryFilter('')
    setSettingsOpen(false)
    setTab('overview')
  }

  function toggleProfitVisibility(field: 'showRealizedProfit' | 'showPotentialProfit') {
    const preferences = state.preferences ?? { showRealizedProfit: true, showPotentialProfit: true }
    setState({ ...state, preferences: { ...preferences, [field]: !preferences[field] } })
  }

  async function resetData(mode: 'activity' | 'inventory' | 'all') {
    setUndoEntry({ snapshot: state, label: mode === 'activity' ? 'Cleared activity' : mode === 'inventory' ? 'Cleared inventory' : 'Cleared all data' })
    if (mode === 'activity') {
      setState((current) => ({ ...current, transactions: [], trades: [] }))
    } else if (mode === 'inventory') {
      setState((current) => ({ ...current, lots: [] }))
    } else {
      await clearSavedState()
      const id = crypto.randomUUID()
      setWorkspace({ activeShowId: id, shows: [{ id, createdAt: new Date().toISOString(), showName: 'New Show', showDate: new Date().toISOString().slice(0, 10), lots: [], transactions: [], trades: [] }] })
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setTab('overview')} aria-label="Go to overview">
          <span className="brand-mark"><BarChart3 size={19} /></span>
          <span><strong>Tabletop</strong> Ledger</span>
        </button>
        <button className="show-pill" onClick={() => setSettingsOpen(true)} aria-label="Switch active show">
          <span className="live-dot" />
          <div><span>Active show</span><strong>{state.showName}</strong></div>
          <ChevronDown size={16} />
        </button>
        <button className="global-search-trigger" onClick={() => setGlobalSearchOpen(true)}><Search /><span>Find any card</span><kbd>/</kbd></button>
        <nav>
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
          <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>Inventory <span>{stats.units}</span></button>
          <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Activity</button>
        </nav>
        <button className="icon-button" aria-label="Settings" onClick={() => setSettingsOpen(true)}><Settings size={19} /></button>
        <button className="mobile-menu" aria-label="Menu and settings" onClick={() => setSettingsOpen(true)}><Menu size={22} /></button>
      </header>

      <main>
        {tab === 'overview' && <Overview state={state} stats={stats} onBuy={() => startBuy()} onSell={() => startSale()} onTrade={() => setTradeOpen(true)} onToggleProfit={toggleProfitVisibility} onTab={setTab} />}
        {tab === 'inventory' && <Inventory lots={filteredLots} total={state.lots.length} filter={inventoryFilter} setFilter={setInventoryFilter} onBuy={() => startBuy()} onSell={() => startSale()} onTrade={() => setTradeOpen(true)} onSellLot={startSale} onEditLot={setEditingLot} onRemoveLot={removeLot} />}
        {tab === 'activity' && <Activity transactions={state.transactions} trades={state.trades ?? []} />}
      </main>

      <div className="mobile-actions">
        <button className="buy" onClick={() => startBuy()}><ArrowDownLeft /> Buy</button>
        <button className="trade" onClick={() => setTradeOpen(true)}><Handshake /> Trade</button>
        <button className="sell" onClick={() => startSale()}><ArrowUpRight /> Sell</button>
      </div>

      {flow && <TransactionModal flow={flow} lots={state.lots} initialCard={buyCard} initialLot={saleLot} recentCards={recentCards} onClose={closeTransaction} onBuy={recordBuy} onSell={recordSale} />}
      {editingLot && <EditLotModal lot={editingLot} onClose={() => setEditingLot(null)} onSave={updateLotPricing} />}
      {tradeOpen && <TradeModal lots={state.lots} onClose={() => setTradeOpen(false)} onSave={recordTrade} />}
      {settingsOpen && <SettingsModal state={state} shows={workspace.shows} activeShowId={workspace.activeShowId} onClose={() => setSettingsOpen(false)} onUpdateShow={updateShow} onCreateShow={createShow} onSwitchShow={switchShow} onReset={resetData} onExport={() => exportLedgerCsv(state)} />}
      {globalSearchOpen && <GlobalSearchModal lots={state.lots} onClose={() => setGlobalSearchOpen(false)} onBuy={(card) => { setGlobalSearchOpen(false); startBuy(card) }} onSell={(lot) => { setGlobalSearchOpen(false); startSale(lot) }} />}
      {undoEntry && <div className="undo-toast"><span><Check /> {undoEntry.label}</span><button onClick={() => { setState(undoEntry.snapshot); setUndoEntry(null) }}><Undo2 /> Undo</button></div>}
    </div>
  )
}

function Overview({ state, stats, onBuy, onSell, onTrade, onToggleProfit, onTab }: { state: LedgerState; stats: Stats; onBuy: () => void; onSell: () => void; onTrade: () => void; onToggleProfit: (field: 'showRealizedProfit' | 'showPotentialProfit') => void; onTab: (tab: 'inventory' | 'activity') => void }) {
  const recentEvents = [...state.transactions.map((item) => ({ kind: 'transaction' as const, item })), ...(state.trades ?? []).map((item) => ({ kind: 'trade' as const, item }))].sort((a, b) => b.item.timestamp.localeCompare(a.item.timestamp)).slice(0, 5)
  const preferences = state.preferences ?? { showRealizedProfit: true, showPotentialProfit: true }
  return <>
    <section className="hero-row">
      <div><p className="eyebrow">SHOW COMMAND CENTER</p><h1>Keep the table moving.</h1><p>Every card, cost, and deal—captured while it happens.</p></div>
      <div className="desktop-actions"><button className="action buy" onClick={onBuy}><ArrowDownLeft /> Record buy</button><button className="action trade" onClick={onTrade}><Handshake /> Record trade</button><button className="action sell" onClick={onSell}><ArrowUpRight /> Record sale</button></div>
    </section>
    <section className="stat-grid">
      <StatCard label="Realized profit" value={money.format(stats.profit)} detail={`${state.transactions.filter((tx) => tx.type === 'sell').length} sales · ${(state.trades ?? []).length} trades`} icon={<CircleDollarSign />} tone="profit" concealed={!preferences.showRealizedProfit} onToggle={() => onToggleProfit('showRealizedProfit')} />
      <StatCard label="Potential profit" value={money.format(stats.potential)} detail="Market value − cost basis" icon={<Sparkles />} tone="potential" concealed={!preferences.showPotentialProfit} onToggle={() => onToggleProfit('showPotentialProfit')} />
      <StatCard label="Inventory value" value={money.format(stats.market)} detail={`${stats.units} items on hand`} icon={<Box />} />
      <StatCard label="Inventory cost basis" value={money.format(stats.cost)} detail={`${money.format(stats.buys)} cash spent at show`} icon={<ArrowDownLeft />} />
      <StatCard label="Cash received" value={money.format(stats.revenue)} detail={`${state.transactions.filter((tx) => tx.type === 'sell').length} sales · ${(state.trades ?? []).length} trades`} icon={<ArrowUpRight />} />
    </section>
    <section className="content-grid">
      <div className="panel">
        <div className="panel-heading"><div><p className="eyebrow">RECENT MOVEMENT</p><h2>Show activity</h2></div><button className="text-button" onClick={() => onTab('activity')}>View all</button></div>
        {recentEvents.length ? <div className="activity-list">{recentEvents.map((event) => event.kind === 'trade' ? <TradeRow key={event.item.id} trade={event.item} /> : <ActivityRow key={event.item.id} tx={event.item} />)}</div> : <EmptyActivity onBuy={onBuy} onSell={onSell} />}
      </div>
      <div className="panel inventory-glance">
        <div className="panel-heading"><div><p className="eyebrow">AT A GLANCE</p><h2>Inventory</h2></div><button className="text-button" onClick={() => onTab('inventory')}>Manage</button></div>
        <div className="value-block"><span>Total cost basis</span><strong>{money.format(stats.cost)}</strong><small>Potential spread <b>+{money.format(Math.max(0, stats.market - stats.cost))}</b></small></div>
        <div className="mini-list">{state.lots.slice(0, 3).map((lot) => <div key={lot.lotId}><CardThumb lot={lot} /><span><strong>{lot.name}</strong><small>{lot.setCode}{productNumber(lot)} · {productVariant(lot)}</small></span><b>×{lot.quantity}</b></div>)}</div>
      </div>
    </section>
  </>
}

function StatCard({ label, value, detail, icon, tone, concealed = false, onToggle }: { label: string; value: string; detail: string; icon: React.ReactNode; tone?: string; concealed?: boolean; onToggle?: () => void }) {
  return <article className={`stat-card ${tone ?? ''} ${concealed ? 'concealed' : ''}`}><div className="stat-top"><span>{label}</span><div className="stat-icons"><i>{icon}</i>{onToggle && <button onClick={onToggle} aria-label={`${concealed ? 'Show' : 'Hide'} ${label}`}>{concealed ? <EyeOff /> : <Eye />}</button>}</div></div><strong>{concealed ? '••••' : value}</strong><small>{concealed ? 'Value hidden' : detail}</small></article>
}

function EmptyActivity({ onBuy, onSell }: { onBuy: () => void; onSell: () => void }) {
  return <div className="empty-state"><span><Sparkles /></span><h3>Your show ledger is ready</h3><p>Record your first deal to start seeing profit and activity here.</p><div><button onClick={onBuy}>Record a buy</button><button onClick={onSell}>Record a sale</button></div></div>
}

function Inventory({ lots, total, filter, setFilter, onBuy, onSell, onTrade, onSellLot, onEditLot, onRemoveLot }: { lots: InventoryLot[]; total: number; filter: string; setFilter: (s: string) => void; onBuy: () => void; onSell: () => void; onTrade: () => void; onSellLot: (lot: InventoryLot) => void; onEditLot: (lot: InventoryLot) => void; onRemoveLot: (lot: InventoryLot) => void }) {
  return <>
    <section className="page-title"><div><p className="eyebrow">YOUR STOCK</p><h1>Inventory</h1><p>{total} lots, organized by acquisition cost.</p></div><div className="desktop-actions"><button className="action buy" onClick={onBuy}><Plus /> Add items</button><button className="action trade" onClick={onTrade}><Handshake /> Trade</button><button className="action sell" onClick={onSell}><ArrowUpRight /> Record sale</button></div></section>
    <div className="search-bar"><Search /><input aria-label="Filter inventory" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search inventory by card, set, or number…" />{filter && <button onClick={() => setFilter('')}><X /></button>}</div>
    <section className="inventory-table panel">
      <div className="table-head"><span>Product</span><span>Condition</span><span>Qty.</span><span>Unit cost</span><span>Market</span><span>Potential</span><span>Actions</span></div>
      {lots.map((lot) => { const marketPrice = effectiveMarketPrice(lot); return <div className="table-row" key={lot.lotId}><div className="card-cell"><CardThumb lot={lot} /><span><strong>{lot.name}</strong><small>{lot.setName} · #{lot.number} · {lot.variant ?? 'Unspecified'}{lot.certificationNumber ? ` · Cert ${lot.certificationNumber}` : ''}</small></span></div><span className={`condition ${lot.cardFormat === 'graded' ? 'graded' : ''}`}>{lotDescriptor(lot)}</span><b>{lot.quantity}</b><span>{money.format(lot.unitCost)}</span><span className="market-cell">{marketPrice !== undefined ? money.format(marketPrice) : '—'}{lot.marketPriceOverride !== undefined && <small>Manual</small>}</span><span className={(marketPrice ?? 0) >= lot.unitCost ? 'positive' : 'negative'}>{marketPrice !== undefined ? money.format((marketPrice - lot.unitCost) * lot.quantity) : '—'}</span><div className="row-actions"><button className="row-sell" onClick={() => onSellLot(lot)}><ArrowUpRight /> Sell</button><button className="row-edit" onClick={() => onEditLot(lot)} aria-label={`Edit pricing for ${lot.name}`} title="Edit cost basis and market price"><Pencil /></button><button className="row-remove" onClick={() => onRemoveLot(lot)} aria-label={`Remove ${lot.name} from inventory`} title="Remove without recording a transaction"><Trash2 /></button></div></div> })}
      {!lots.length && <div className="empty-row"><PackageOpen /><h3>No products found</h3><p>Try another search or add an item to inventory.</p></div>}
    </section>
  </>
}

function Activity({ transactions, trades }: { transactions: Transaction[]; trades: TradeEvent[] }) {
  const events = [...transactions.map((item) => ({ kind: 'transaction' as const, item })), ...trades.map((item) => ({ kind: 'trade' as const, item }))].sort((a, b) => b.item.timestamp.localeCompare(a.item.timestamp))
  return <><section className="page-title"><div><p className="eyebrow">COMPLETE LEDGER</p><h1>Activity</h1><p>A record of every buy, sale, and trade at this show.</p></div></section><section className="panel activity-page">{events.length ? events.map((event) => event.kind === 'trade' ? <TradeRow key={event.item.id} trade={event.item} /> : <ActivityRow key={event.item.id} tx={event.item} />) : <div className="empty-row"><ShoppingBag /><h3>No deals yet</h3><p>Your show transactions will appear here.</p></div>}</section></>
}

function TradeRow({ trade }: { trade: TradeEvent }) {
  const outgoingValue = trade.outgoing.reduce((sum, line) => sum + line.quantity * line.unitTradeValue, 0)
  const incomingValue = trade.incoming.reduce((sum, line) => sum + line.quantity * line.unitTradeValue, 0)
  const outgoingBasis = trade.outgoing.reduce((sum, line) => sum + line.quantity * line.unitCost, 0)
  const profit = Math.max(0, trade.cashReceived - outgoingBasis - trade.cashPaid)
  return <div className="activity-row trade-row"><span className="flow-icon trade"><Handshake /></span><div><strong>Traded {trade.outgoing.reduce((sum, line) => sum + line.quantity, 0)} out · {trade.incoming.reduce((sum, line) => sum + line.quantity, 0)} in</strong><small>{trade.outgoing.map((line) => line.cardName).join(', ')} → {trade.incoming.map((line) => line.cardName).join(', ')}</small></div><time>{new Date(trade.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><span className="tx-total"><strong>{money.format(Math.max(outgoingValue + trade.cashPaid, incomingValue + trade.cashReceived))}</strong><small className={profit >= 0 ? 'positive' : 'negative'}>{profit >= 0 ? '+' : '−'}{money.format(Math.abs(profit))} realized</small></span></div>
}

function ActivityRow({ tx }: { tx: Transaction }) {
  const total = tx.quantity * tx.unitPrice
  const profit = tx.type === 'sell' ? tx.quantity * (tx.unitPrice - tx.unitCost) : null
  return <div className="activity-row"><span className={`flow-icon ${tx.type}`}>{tx.type === 'sell' ? <ArrowUpRight /> : <ArrowDownLeft />}</span><div><strong>{tx.type === 'sell' ? 'Sold' : 'Bought'} {tx.quantity}× {tx.cardName}</strong><small>{tx.setName} · #{tx.cardNumber} · {tx.variant ?? 'Unspecified'} · {lotDescriptor(tx)}</small></div><time>{new Date(tx.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><span className="tx-total"><strong>{tx.type === 'sell' ? '+' : '−'}{money.format(total)}</strong>{profit !== null && <small className={profit >= 0 ? 'positive' : 'negative'}>{profit >= 0 ? '+' : '−'}{money.format(Math.abs(profit))} profit</small>}</span></div>
}

function CardThumb({ lot }: { lot: Pick<InventoryLot, 'image' | 'name'> }) { return lot.image ? <img className="card-thumb" src={lot.image} alt="" /> : <span className="card-thumb fallback">{lot.name[0]}</span> }

function EditLotModal({ lot, onClose, onSave }: { lot: InventoryLot; onClose: () => void; onSave: (lotId: string, unitCost: number, marketPriceOverride?: number) => void }) {
  const [cost, setCost] = useState(lot.unitCost.toFixed(2))
  const [market, setMarket] = useState((effectiveMarketPrice(lot) ?? 0).toFixed(2))
  const [manualMarket, setManualMarket] = useState(lot.marketPriceOverride !== undefined)
  const valid = Number(cost) >= 0 && (!manualMarket || Number(market) >= 0)

  function useApiPrice() {
    setManualMarket(false)
    setMarket(lot.marketPrice?.toFixed(2) ?? '')
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal edit-lot-modal" role="dialog" aria-modal="true">
    <div className="modal-head"><div><p className="eyebrow">INVENTORY LOT</p><h2>Edit pricing</h2></div><button onClick={onClose}><X /></button></div>
    <div className="deal-form">
      <div className="selected-card static"><CardThumb lot={lot} /><span><strong>{lot.name} <small>#{lot.number}</small></strong><small>{lot.setName} · {lot.variant ?? 'Unspecified'} · {lotDescriptor(lot)} · {lot.quantity} available</small></span></div>
      <div className="edit-price-fields">
        <label>Cost basis per card<div className="money-input"><span>$</span><input value={cost} onChange={(event) => setCost(event.target.value)} inputMode="decimal" /></div><small>Future sales from this lot will use this cost. Past profit will not change.</small></label>
        <label><span className="field-label-row">Market price per card{manualMarket && <b>Manual override</b>}</span><div className={`money-input ${manualMarket ? 'manual-price' : ''}`}><span>$</span><input value={market} onChange={(event) => { setMarket(event.target.value); setManualMarket(true) }} inputMode="decimal" /></div><small>{lot.marketPrice !== undefined ? `API price: ${money.format(lot.marketPrice)}` : 'No API market price is available for this card.'}{manualMarket && lot.marketPrice !== undefined && <button onClick={useApiPrice}>Use API price</button>}</small></label>
      </div>
      <button className="submit-deal sell" disabled={!valid} onClick={() => onSave(lot.lotId, Number(cost), manualMarket ? Number(market) : undefined)}><Check /> Save pricing changes</button>
    </div>
  </div></div>
}

function SettingsModal({ state, shows, activeShowId, onClose, onUpdateShow, onCreateShow, onSwitchShow, onReset, onExport }: { state: LedgerState; shows: ShowLedger[]; activeShowId: string; onClose: () => void; onUpdateShow: (name: string, date: string) => void; onCreateShow: (name: string, date: string, carryInventory: boolean) => void; onSwitchShow: (id: string) => void; onReset: (mode: 'activity' | 'inventory' | 'all') => Promise<void>; onExport: () => void }) {
  const [showName, setShowName] = useState(state.showName)
  const [showDate, setShowDate] = useState(state.showDate)
  const [newShowName, setNewShowName] = useState('')
  const [newShowDate, setNewShowDate] = useState(new Date().toISOString().slice(0, 10))
  const [carryInventory, setCarryInventory] = useState(true)

  async function confirmReset(mode: 'activity' | 'inventory' | 'all', message: string) {
    if (!window.confirm(message)) return
    await onReset(mode)
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal settings-modal" role="dialog" aria-modal="true">
    <div className="modal-head"><div><p className="eyebrow">SHOW & DATA</p><h2>Settings</h2></div><button onClick={onClose}><X /></button></div>
    <div className="settings-body">
      <section className="settings-section">
        <div className="settings-title"><div><h3>Your shows</h3><p>Switch shows without losing their inventory, sales, trades, or totals.</p></div></div>
        <div className="show-list">{shows.map((show) => <button key={show.id} className={show.id === activeShowId ? 'active' : ''} onClick={() => onSwitchShow(show.id)}><span><strong>{show.showName}</strong><small>{new Date(`${show.showDate}T12:00:00`).toLocaleDateString()} · {show.lots.reduce((sum, lot) => sum + lot.quantity, 0)} items · {show.transactions.length + (show.trades?.length ?? 0)} deals</small></span>{show.id === activeShowId ? <Check /> : <ChevronDown />}</button>)}</div>
        <div className="new-show-fields"><label>New show name<input value={newShowName} onChange={(event) => setNewShowName(event.target.value)} placeholder="e.g. Collect-A-Con Orlando" /></label><label>Date<input type="date" value={newShowDate} onChange={(event) => setNewShowDate(event.target.value)} /></label></div>
        <label className="carry-inventory"><input type="checkbox" checked={carryInventory} onChange={(event) => setCarryInventory(event.target.checked)} /><span><strong>Carry current inventory into the new show</strong><small>Starts with the same items and cost basis, but no sales or trade activity.</small></span></label>
        <button className="settings-primary" disabled={!newShowName.trim() || !newShowDate} onClick={() => onCreateShow(newShowName, newShowDate, carryInventory)}><Plus /> Create and open show</button>
      </section>
      <section className="settings-section">
        <div className="settings-title"><div><h3>Show details</h3><p>Used to label your dashboard and exports.</p></div></div>
        <div className="settings-fields"><label>Show name<input value={showName} onChange={(event) => setShowName(event.target.value)} /></label><label>Date<input type="date" value={showDate} onChange={(event) => setShowDate(event.target.value)} /></label></div>
        <button className="settings-primary" onClick={() => onUpdateShow(showName.trim() || 'Untitled Show', showDate)}><Check /> Save show details</button>
      </section>
      <section className="settings-section">
        <div className="settings-title"><span className="settings-symbol"><Download /></span><div><h3>Export your ledger</h3><p>Downloads current inventory and every transaction in one CSV.</p></div></div>
        <button className="settings-secondary" onClick={onExport}><Download /> Export all data as CSV</button>
      </section>
      <section className="settings-section">
        <div className="settings-title"><span className="settings-symbol"><Database /></span><div><h3>Device backup</h3><p>Your ledger is saved in normal browser storage and a separate application database on this device.</p></div></div>
        <span className="backup-status"><Check /> Two local copies active</span>
      </section>
      <section className="settings-section danger-zone">
        <div className="settings-title"><span className="settings-symbol"><RotateCcw /></span><div><h3>Reset data</h3><p>Choose exactly what you want to clear.</p></div></div>
        <div className="reset-grid">
          <button onClick={() => confirmReset('activity', 'Clear all buy and sale activity?\n\nYour inventory will stay unchanged.')}><strong>Clear activity</strong><small>Keep current inventory</small></button>
          <button onClick={() => confirmReset('inventory', 'Clear the entire inventory?\n\nTransaction history and realized profit will stay unchanged.')}><strong>Clear inventory</strong><small>Keep activity and profit</small></button>
          <button className="reset-all" onClick={() => confirmReset('all', 'Clear everything?\n\nThis permanently removes all inventory, activity, and both saved copies on this device.')}><strong>Clear everything</strong><small>Empty inventory and activity</small></button>
        </div>
      </section>
    </div>
  </div></div>
}

function GlobalSearchModal({ lots, onClose, onBuy, onSell }: { lots: InventoryLot[]; onClose: () => void; onBuy: (card: CardResult) => void; onSell: (lot: InventoryLot) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardResult[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (query.trim().length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try { setResults(await searchCards(query, controller.signal)) }
      catch (error) { if ((error as Error).name !== 'AbortError') setResults(localSearch(query)) }
      finally { setLoading(false) }
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query])
  const inventory = query.trim() ? lots.filter((lot) => `${lot.name} ${lot.number} ${lot.setName} ${lot.variant ?? ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 5) : []
  return <div className="modal-backdrop command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal command-modal" role="dialog" aria-modal="true">
    <div className="command-input"><Search /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search inventory or the full card catalog…" />{loading ? <span className="spinner" /> : <button onClick={onClose}><X /></button>}</div>
    {!query && <div className="command-empty"><kbd>B</kbd><span>Buy</span><kbd>S</kbd><span>Sell</span><kbd>T</kbd><span>Trade</span><p>Type a card name or collector number to begin.</p></div>}
    {inventory.length > 0 && <section className="command-section"><p>IN YOUR INVENTORY</p>{inventory.map((lot) => <div className="command-row" key={lot.lotId}><CardThumb lot={lot} /><span><strong>{lot.name}</strong><small>{lot.setName} · {lot.variant ?? 'Unspecified'} · {lotDescriptor(lot)} · {lot.quantity} available</small></span><button className="row-sell" onClick={() => onSell(lot)}><ArrowUpRight /> Sell</button></div>)}</section>}
    {query.length >= 2 && <section className="command-section"><p>CARD CATALOG</p>{results.slice(0, 8).map((card) => <div className="command-row" key={card.id}><CardThumb lot={card} /><span><strong>{card.name}</strong><small>{card.setName} · #{card.number}</small></span><button onClick={() => onBuy(card)}><ArrowDownLeft /> Buy</button></div>)}</section>}
  </div></div>
}

type OutgoingDraft = { lot: InventoryLot; quantity: number; unitTradeValue: number }
type IncomingDraft = { card: CardResult; quantity: number; unitTradeValue: number; condition: Condition; variantId?: number; format: CardFormat; gradingCompany?: string; grade?: string; certificationNumber?: string }

function TradeModal({ lots, onClose, onSave }: { lots: InventoryLot[]; onClose: () => void; onSave: (trade: TradeEvent, incomingLots: InventoryLot[]) => void }) {
  const [outgoing, setOutgoing] = useState<OutgoingDraft[]>([])
  const [incoming, setIncoming] = useState<IncomingDraft[]>([])
  const [outQuery, setOutQuery] = useState('')
  const [inQuery, setInQuery] = useState('')
  const [cardResults, setCardResults] = useState<CardResult[]>([])
  const [searching, setSearching] = useState(false)
  const [cashPaid, setCashPaid] = useState('0')
  const [cashReceived, setCashReceived] = useState('0')

  useEffect(() => {
    if (inQuery.trim().length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try { setCardResults(await searchCards(inQuery, controller.signal)) }
      catch (error) { if ((error as Error).name !== 'AbortError') setCardResults(localSearch(inQuery)) }
      finally { setSearching(false) }
    }, 350)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [inQuery])

  const outResults = lots.filter((lot) => !outgoing.some((item) => item.lot.lotId === lot.lotId) && `${lot.name} ${lot.number} ${lot.setName} ${lot.variant ?? ''}`.toLowerCase().includes(outQuery.toLowerCase())).slice(0, 6)
  const givenValue = outgoing.reduce((sum, item) => sum + item.quantity * item.unitTradeValue, 0) + Number(cashPaid || 0)
  const receivedValue = incoming.reduce((sum, item) => sum + item.quantity * item.unitTradeValue, 0) + Number(cashReceived || 0)
  const difference = receivedValue - givenValue
  const canSave = outgoing.length > 0 && incoming.length > 0 && incoming.every((item) => item.card.productType === 'sealed' || item.format === 'raw' || (item.gradingCompany?.trim() && item.grade?.trim())) && Number(cashPaid) >= 0 && Number(cashReceived) >= 0

  function addOutgoing(lot: InventoryLot) {
    setOutgoing((items) => [...items, { lot, quantity: 1, unitTradeValue: effectiveMarketPrice(lot) ?? lot.unitCost }])
    setOutQuery('')
  }

  async function addIncoming(card: CardResult) {
    const hydrated = await hydrateCard(card)
    const variant = hydrated.variants?.[0]
    setIncoming((items) => [...items, { card: hydrated, quantity: 1, unitTradeValue: variant?.marketPrices.NM ?? hydrated.marketPrice ?? 0, condition: 'NM', variantId: variant?.id, format: 'raw' }])
    setInQuery('')
    setCardResults([])
  }

  function saveTrade() {
    if (!canSave) return
    const timestamp = new Date().toISOString()
    const outgoingBasis = outgoing.reduce((sum, item) => sum + item.quantity * item.lot.unitCost, 0)
    const incomingTradeValue = incoming.reduce((sum, item) => sum + item.quantity * item.unitTradeValue, 0)
    const basisToCarry = Math.max(0, outgoingBasis + Number(cashPaid || 0) - Number(cashReceived || 0))
    const incomingLots: InventoryLot[] = incoming.map((item) => {
      const variant = item.card.variants?.find((option) => option.id === item.variantId)
      const graded = item.card.productType !== 'sealed' && item.format === 'graded'
      const lineTradeValue = item.quantity * item.unitTradeValue
      const lineBasis = incomingTradeValue > 0 ? basisToCarry * (lineTradeValue / incomingTradeValue) : basisToCarry / incoming.length
      return { ...item.card, lotId: crypto.randomUUID(), quantity: item.quantity, unitCost: lineBasis / item.quantity, condition: item.condition, variant: item.card.productType === 'sealed' ? 'Sealed product' : variant?.name ?? 'Unspecified', variantId: variant?.id, marketPrice: variant?.marketPrices[item.condition] ?? item.card.marketPrice, marketPriceOverride: graded ? item.unitTradeValue : undefined, cardFormat: graded ? 'graded' : 'raw', gradingCompany: graded ? item.gradingCompany ?? 'PSA' : undefined, grade: graded ? item.grade ?? '10' : undefined, certificationNumber: graded ? item.certificationNumber : undefined, addedAt: timestamp }
    })
    const outgoingLines: TradeLine[] = outgoing.map((item) => ({ cardId: item.lot.id, lotId: item.lot.lotId, cardName: item.lot.name, cardNumber: item.lot.number, setName: item.lot.setName, setCode: item.lot.setCode, variant: item.lot.variant ?? 'Unspecified', condition: item.lot.condition, cardFormat: item.lot.cardFormat ?? 'raw', gradingCompany: item.lot.gradingCompany, grade: item.lot.grade, certificationNumber: item.lot.certificationNumber, productType: item.lot.productType ?? 'card', quantity: item.quantity, unitTradeValue: item.unitTradeValue, unitCost: item.lot.unitCost, image: item.lot.image }))
    const incomingLines: TradeLine[] = incomingLots.map((lot, index) => ({ cardId: lot.id, lotId: lot.lotId, cardName: lot.name, cardNumber: lot.number, setName: lot.setName, setCode: lot.setCode, variant: lot.variant ?? 'Unspecified', condition: lot.condition, cardFormat: lot.cardFormat, gradingCompany: lot.gradingCompany, grade: lot.grade, certificationNumber: lot.certificationNumber, productType: lot.productType ?? 'card', quantity: lot.quantity, unitTradeValue: incoming[index].unitTradeValue, unitCost: lot.unitCost, image: lot.image }))
    onSave({ id: crypto.randomUUID(), timestamp, outgoing: outgoingLines, incoming: incomingLines, cashPaid: Number(cashPaid || 0), cashReceived: Number(cashReceived || 0) }, incomingLots)
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal trade-modal" role="dialog" aria-modal="true">
    <div className="modal-head"><div><p className="eyebrow">PRODUCTS & CASH</p><h2>Record a trade</h2></div><button onClick={onClose}><X /></button></div>
    <div className="trade-body">
      <div className="trade-columns">
        <section className="trade-side outgoing"><div className="trade-side-title"><span><ArrowUpRight /></span><div><h3>You give</h3><p>Items leaving inventory</p></div></div>
          {outgoing.map((item, index) => <TradeDraftRow key={item.lot.lotId} name={item.lot.name} detail={`${item.lot.variant ?? 'Unspecified'} · ${lotDescriptor(item.lot)}`} image={item.lot.image} quantity={item.quantity} maxQuantity={item.lot.quantity} value={item.unitTradeValue} onQuantity={(quantity) => setOutgoing((items) => items.map((draft, i) => i === index ? { ...draft, quantity } : draft))} onValue={(unitTradeValue) => setOutgoing((items) => items.map((draft, i) => i === index ? { ...draft, unitTradeValue } : draft))} onRemove={() => setOutgoing((items) => items.filter((_, i) => i !== index))} />)}
          <div className="trade-search"><Search /><input value={outQuery} onChange={(event) => setOutQuery(event.target.value)} placeholder="Search your inventory…" /></div>
          {outQuery && <div className="trade-results">{outResults.map((lot) => <button key={lot.lotId} onClick={() => addOutgoing(lot)}><CardThumb lot={lot} /><span><strong>{lot.name}</strong><small>{lot.variant ?? 'Unspecified'} · {lot.quantity} available</small></span><Plus /></button>)}</div>}
          <label className="cash-field">Cash you pay<div className="money-input"><span>$</span><input value={cashPaid} onChange={(event) => setCashPaid(event.target.value)} inputMode="decimal" /></div></label>
        </section>
        <section className="trade-side incoming"><div className="trade-side-title"><span><ArrowDownLeft /></span><div><h3>You receive</h3><p>Items entering inventory</p></div></div>
          {incoming.map((item, index) => { const variant = item.card.variants?.find((option) => option.id === item.variantId); return <div className="incoming-draft" key={`${item.card.id}-${index}`}><TradeDraftRow name={item.card.name} detail={`${variant?.name ?? 'Unspecified'} · ${item.format === 'graded' ? `${item.gradingCompany ?? 'PSA'} ${item.grade ?? '10'}` : item.condition}`} image={item.card.image} quantity={item.quantity} value={item.unitTradeValue} onQuantity={(quantity) => setIncoming((items) => items.map((draft, i) => i === index ? { ...draft, quantity } : draft))} onValue={(unitTradeValue) => setIncoming((items) => items.map((draft, i) => i === index ? { ...draft, unitTradeValue } : draft))} onRemove={() => setIncoming((items) => items.filter((_, i) => i !== index))} /><div className="trade-line-options"><select value={item.variantId ?? ''} onChange={(event) => setIncoming((items) => items.map((draft, i) => i === index ? { ...draft, variantId: Number(event.target.value) } : draft))}>{item.card.variants?.length ? item.card.variants.map((option) => <option value={option.id} key={option.id}>{option.name}</option>) : <option value="">Unspecified</option>}</select><select value={item.format} onChange={(event) => setIncoming((items) => items.map((draft, i) => i === index ? { ...draft, format: event.target.value as CardFormat, gradingCompany: 'PSA', grade: '10' } : draft))}><option value="raw">Raw</option><option value="graded">Graded</option></select>{item.format === 'raw' ? <select value={item.condition} onChange={(event) => setIncoming((items) => items.map((draft, i) => i === index ? { ...draft, condition: event.target.value as Condition } : draft))}>{conditions.map((condition) => <option key={condition}>{condition}</option>)}</select> : <><select value={item.gradingCompany ?? 'PSA'} onChange={(event) => setIncoming((items) => items.map((draft, i) => i === index ? { ...draft, gradingCompany: event.target.value } : draft))}>{gradingCompanies.map((company) => <option key={company}>{company}</option>)}</select><input value={item.grade ?? '10'} onChange={(event) => setIncoming((items) => items.map((draft, i) => i === index ? { ...draft, grade: event.target.value } : draft))} aria-label="Grade" placeholder="Grade" /><input value={item.certificationNumber ?? ''} onChange={(event) => setIncoming((items) => items.map((draft, i) => i === index ? { ...draft, certificationNumber: event.target.value } : draft))} aria-label="Certification number" placeholder="Cert #" /></>}</div></div> })}
          <div className="trade-search"><Search /><input value={inQuery} onChange={(event) => setInQuery(event.target.value)} placeholder="Search cards and sealed products…" />{searching && <span className="spinner" />}</div>
          {inQuery.length >= 2 && <div className="trade-results">{cardResults.slice(0, 6).map((card) => <button key={card.id} onClick={() => void addIncoming(card)}><CardThumb lot={card} /><span><strong>{card.name}</strong><small>{card.setName} · #{card.number}</small></span><Plus /></button>)}</div>}
          <label className="cash-field">Cash you receive<div className="money-input"><span>$</span><input value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} inputMode="decimal" /></div></label>
        </section>
      </div>
      <div className={`trade-summary ${Math.abs(difference) < .01 ? 'balanced' : ''}`}><div><span>You give</span><strong>{money.format(givenValue)}</strong></div><Handshake /><div><span>You receive</span><strong>{money.format(receivedValue)}</strong></div><p>{Math.abs(difference) < .01 ? 'Trade is balanced' : `${money.format(Math.abs(difference))} difference — saving is still allowed`}</p></div>
      <button className="submit-deal sell" disabled={!canSave} onClick={saveTrade}><Check /> Record trade</button>
    </div>
  </div></div>
}

function TradeDraftRow({ name, detail, image, quantity, maxQuantity = 99, value, onQuantity, onValue, onRemove }: { name: string; detail: string; image?: string; quantity: number; maxQuantity?: number; value: number; onQuantity: (value: number) => void; onValue: (value: number) => void; onRemove: () => void }) {
  return <div className="trade-draft-row"><CardThumb lot={{ name, image }} /><div><strong>{name}</strong><small>{detail}</small></div><label>Qty<input type="number" min="1" max={maxQuantity} value={quantity} onChange={(event) => onQuantity(Math.max(1, Math.min(maxQuantity, Number(event.target.value))))} /></label><label>Value ea.<div><span>$</span><input inputMode="decimal" value={value} onChange={(event) => onValue(Math.max(0, Number(event.target.value)))} /></div></label><button onClick={onRemove} aria-label={`Remove ${name}`}><X /></button></div>
}

function TransactionModal({ flow, lots, initialCard, initialLot, recentCards, onClose, onBuy, onSell }: { flow: Flow; lots: InventoryLot[]; initialCard?: CardResult | null; initialLot?: InventoryLot | null; recentCards: InventoryLot[]; onClose: () => void; onBuy: (card: CardResult, quantity: number, price: number, condition: Condition, variant?: CardVariant, details?: PurchaseDetails) => void; onSell: (lot: InventoryLot, quantity: number, price: number) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardResult[]>([])
  const [selectedCard, setSelectedCard] = useState<CardResult | null>(initialCard ?? null)
  const [selectedLot, setSelectedLot] = useState<InventoryLot | null>(initialLot ?? null)
  const [loading, setLoading] = useState(false)
  const [offline, setOffline] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [price, setPrice] = useState(initialLot ? (effectiveMarketPrice(initialLot) ?? initialLot.unitCost).toFixed(2) : initialCard?.marketPrice?.toFixed(2) ?? '')
  const [condition, setCondition] = useState<Condition>(initialLot?.condition ?? 'NM')
  const [variantId, setVariantId] = useState<number | undefined>(initialLot?.variantId ?? initialCard?.variants?.[0]?.id)
  const [cardFormat, setCardFormat] = useState<CardFormat>(initialLot?.cardFormat ?? 'raw')
  const [gradingCompany, setGradingCompany] = useState(initialLot?.gradingCompany ?? 'PSA')
  const [grade, setGrade] = useState(initialLot?.grade ?? '10')
  const [certificationNumber, setCertificationNumber] = useState(initialLot?.certificationNumber ?? '')
  const [notes, setNotes] = useState(initialLot?.notes ?? '')
  const [gradedMarketValue, setGradedMarketValue] = useState(initialLot?.cardFormat === 'graded' ? (effectiveMarketPrice(initialLot)?.toFixed(2) ?? '') : '')

  useEffect(() => {
    if (flow === 'sell') return
    if (query.trim().length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true); setOffline(false)
      try { setResults(await searchCards(query, controller.signal)) }
      catch (error) { if ((error as Error).name !== 'AbortError') { setResults(localSearch(query)); setOffline(true) } }
      finally { setLoading(false) }
    }, 350)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query, flow])

  const inventoryResults = lots.filter((lot) => `${lot.name} ${lot.number} ${lot.setName} ${lot.setCode} ${lot.variant ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const visibleResults = flow === 'buy' ? (query.trim().length >= 2 ? results : []) : (query.trim() ? inventoryResults : [])
  const chosen = flow === 'buy' ? selectedCard : selectedLot
  const isSealed = chosen?.productType === 'sealed'
  const selectedVariant = selectedCard?.variants?.find((variant) => variant.id === variantId)
  const manualGradedPrice = gradedMarketValue.trim() !== '' && Number.isFinite(Number(gradedMarketValue)) ? Number(gradedMarketValue) : undefined
  const pricingBase = flow === 'buy' ? !isSealed && cardFormat === 'graded' ? manualGradedPrice : selectedVariant?.marketPrices[condition] ?? selectedCard?.marketPrice : selectedLot ? effectiveMarketPrice(selectedLot) : undefined
  const gradedValid = isSealed || cardFormat === 'raw' || (gradingCompany.trim() && grade.trim() && gradedMarketValue.trim() !== '' && Number(gradedMarketValue) >= 0)
  const valid = chosen && quantity > 0 && price.trim() !== '' && Number(price) >= 0 && gradedValid && (flow === 'buy' || quantity <= (selectedLot?.quantity ?? 0))

  async function chooseCard(card: CardResult) {
    setLoading(true)
    const hydrated = await hydrateCard(card)
    const firstVariant = hydrated.variants?.[0]
    setSelectedCard(hydrated)
    setVariantId(firstVariant?.id)
    setPrice((firstVariant?.marketPrices[condition] ?? hydrated.marketPrice)?.toFixed(2) ?? '')
    setLoading(false)
  }
  function chooseLot(lot: InventoryLot) {
    setSelectedLot(lot)
    setCondition(lot.condition)
    setCardFormat(lot.cardFormat ?? 'raw')
    setGradingCompany(lot.gradingCompany ?? 'PSA')
    setGrade(lot.grade ?? '10')
    setCertificationNumber(lot.certificationNumber ?? '')
    setGradedMarketValue(lot.cardFormat === 'graded' ? (effectiveMarketPrice(lot)?.toFixed(2) ?? '') : '')
    setPrice((effectiveMarketPrice(lot) ?? lot.unitCost).toFixed(2))
  }
  function submit() {
    if (!valid) return
    if (flow === 'buy' && selectedCard) onBuy(selectedCard, quantity, Number(price), condition, isSealed ? undefined : selectedVariant, { format: isSealed ? 'raw' : cardFormat, gradingCompany: !isSealed && cardFormat === 'graded' ? gradingCompany.trim() : undefined, grade: !isSealed && cardFormat === 'graded' ? grade.trim() : undefined, certificationNumber: !isSealed && cardFormat === 'graded' ? certificationNumber.trim() || undefined : undefined, notes: notes.trim() || undefined, gradedMarketValue: !isSealed && cardFormat === 'graded' ? Number(gradedMarketValue) : undefined })
    if (flow === 'sell' && selectedLot) onSell(selectedLot, quantity, Number(price))
    onClose()
  }

  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal" role="dialog" aria-modal="true">
    <div className="modal-head"><div><p className="eyebrow">{flow === 'buy' ? 'INCOMING INVENTORY' : 'OUTGOING INVENTORY'}</p><h2>{flow === 'buy' ? 'Record a buy' : 'Record a sale'}</h2></div><button onClick={onClose}><X /></button></div>
    {!chosen ? <div className="finder">
      <label>{flow === 'buy' ? 'Find a card or sealed product' : 'Find it in inventory'}</label>
      <div className="search-bar"><Search /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={flow === 'buy' ? 'Try “Froakie 060” or “060”…' : 'Search your cards…'} />{loading && <span className="spinner" />}</div>
      {offline && <p className="notice">Live catalog unavailable—showing offline matches.</p>}
      {!query && (flow !== 'buy' || recentCards.length === 0) && <div className="search-prompt"><Search /><h3>Search cards or sealed products</h3><p>{flow === 'buy' ? 'We’ll look across the Pokémon TCG catalog.' : 'Choose the exact inventory lot you sold from.'}</p></div>}
      {!query && flow === 'buy' && recentCards.length > 0 && <div className="recent-cards"><p>RECENT CARDS</p>{recentCards.map((card) => <button key={card.lotId} onClick={() => void chooseCard(card)}><CardThumb lot={card} /><span><strong>{card.name}</strong><small>{card.setName} · #{card.number}</small></span></button>)}</div>}
      <div className="result-list">{visibleResults.map((item) => {
        const lot = item as InventoryLot
        const shownMarket = flow === 'sell' ? effectiveMarketPrice(lot) : item.marketPrice
        return <button key={flow === 'buy' ? item.id : lot.lotId} onClick={() => flow === 'buy' ? void chooseCard(item) : chooseLot(lot)}><CardThumb lot={item} /><span><strong>{item.name} <small>#{item.number}</small></strong><small>{item.setName} · {item.setCode}{flow === 'sell' ? ` · ${lot.variant ?? 'Unspecified'} · ${lotDescriptor(lot)} · ${lot.quantity} available` : item.variants?.length ? ` · ${item.variants.map((variant) => variant.name).join(' / ')}` : ''}</small></span><b>{shownMarket !== undefined ? money.format(shownMarket) : 'Select'}</b></button>
      })}</div>
      {query.length >= 2 && !loading && visibleResults.length === 0 && <div className="search-prompt compact"><PackageOpen /><h3>No matches yet</h3><p>Check the spelling or try only the collector number.</p></div>}
    </div> : <div className="deal-form">
      <button className="selected-card" onClick={() => flow === 'buy' ? setSelectedCard(null) : setSelectedLot(null)}><CardThumb lot={chosen} /><span><strong>{chosen.name} <small>#{chosen.number}</small></strong><small>{chosen.setName}{flow === 'sell' ? ` · ${selectedLot?.variant ?? 'Unspecified'}` : ''}</small></span><em>Change</em></button>
      {flow === 'buy' && !isSealed && <div className="format-toggle"><button className={cardFormat === 'raw' ? 'active' : ''} onClick={() => setCardFormat('raw')}>Raw card</button><button className={cardFormat === 'graded' ? 'active' : ''} onClick={() => setCardFormat('graded')}>Graded slab</button></div>}
      <div className="form-grid">
        {isSealed ? <label>Product type<input className="plain-input" value="Sealed product" disabled /></label> : <label>Variant<select value={flow === 'buy' ? variantId ?? '' : selectedLot?.variant ?? 'Unspecified'} onChange={(e) => { const id = Number(e.target.value); setVariantId(id); const variant = selectedCard?.variants?.find((item) => item.id === id); const suggested = variant?.marketPrices[condition]; if (suggested !== undefined) setPrice(suggested.toFixed(2)) }} disabled={flow === 'sell'}>{flow === 'buy' ? selectedCard?.variants?.length ? selectedCard.variants.map((variant) => <option value={variant.id} key={variant.id}>{variant.name}</option>) : <option value="">Unspecified</option> : <option>{selectedLot?.variant ?? 'Unspecified'}</option>}</select></label>}
        {isSealed ? null : flow === 'buy' && cardFormat === 'graded' ? <><label>Grading company<select value={gradingCompany} onChange={(e) => setGradingCompany(e.target.value)}>{gradingCompanies.map((company) => <option key={company}>{company}</option>)}</select></label><label>Grade<input className="plain-input" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="10, 9.5, Authentic…" /></label><label>Certification number<input className="plain-input" value={certificationNumber} onChange={(e) => setCertificationNumber(e.target.value)} placeholder="Optional" /></label></> : flow === 'sell' && selectedLot?.cardFormat === 'graded' ? <label>Grade<input className="plain-input" value={lotDescriptor(selectedLot)} disabled /></label> : <label>Condition<select value={condition} onChange={(e) => setCondition(e.target.value as Condition)} disabled={flow === 'sell'}>{conditions.map((c) => <option key={c}>{c}</option>)}</select></label>}
        <label>Quantity<div className="quantity-input"><button onClick={() => setQuantity(Math.max(1, quantity - 1))}><Minus /></button><input value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} type="number" min="1" /><button onClick={() => setQuantity(Math.min(selectedLot?.quantity ?? 99, quantity + 1))}><Plus /></button></div></label>
        <label className="price-label">{flow === 'buy' ? 'Cost per card' : 'Sale price per card'}<div className="money-input"><span>$</span><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" /></div>{pricingBase !== undefined && <><div className="price-presets">{[70, 75, 80, 85, 90].map((percent) => <button type="button" key={percent} onClick={() => setPrice((pricingBase * percent / 100).toFixed(2))}>{percent}%</button>)}<button type="button" onClick={() => setPrice((Math.round(pricingBase / 5) * 5).toFixed(2))}>Nearest $5</button></div><small className="price-hint">Market reference: {money.format(pricingBase)}</small></>}</label>
        {flow === 'buy' && !isSealed && cardFormat === 'graded' && <><label className="price-label"><span className="field-label-row">Graded market value<b>Manual value</b></span><div className="money-input manual-price"><span>$</span><input value={gradedMarketValue} onChange={(e) => setGradedMarketValue(e.target.value)} inputMode="decimal" placeholder="0.00" /></div><small className="price-hint">TCGTracking does not provide graded pricing, so this value is entered manually.</small></label><label className="price-label">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Subgrades, label type, qualifiers, purchase notes…" /></label></>}
      </div>
      {flow === 'sell' && selectedLot && <div className="profit-preview"><span>Estimated profit</span><strong className={Number(price) >= selectedLot.unitCost ? 'positive' : 'negative'}>{money.format(quantity * (Number(price || 0) - selectedLot.unitCost))}</strong><small>Cost basis: {money.format(quantity * selectedLot.unitCost)}</small></div>}
      <button className={`submit-deal ${flow}`} disabled={!valid} onClick={submit}><Check /> {flow === 'buy' ? `Add ${quantity} to inventory` : `Complete ${money.format(quantity * Number(price || 0))} sale`}</button>
    </div>}
  </div></div>
}

export default App
