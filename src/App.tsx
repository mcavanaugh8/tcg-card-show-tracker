import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownLeft, ArrowUpRight, BarChart3, Box, Check, ChevronDown, CircleDollarSign,
  Menu, Minus, PackageOpen, Plus, Search, Settings, ShoppingBag, Sparkles, X,
} from 'lucide-react'
import { localSearch, searchCards } from './cardApi'
import { loadState, saveState } from './storage'
import type { CardResult, Condition, InventoryLot, LedgerState, Transaction } from './types'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const conditions: Condition[] = ['NM', 'LP', 'MP', 'HP', 'DMG']

type Flow = 'buy' | 'sell'
type Stats = { units: number; cost: number; market: number; revenue: number; profit: number; buys: number }

function App() {
  const [state, setState] = useState<LedgerState>(loadState)
  const [tab, setTab] = useState<'overview' | 'inventory' | 'activity'>('overview')
  const [flow, setFlow] = useState<Flow | null>(null)
  const [inventoryFilter, setInventoryFilter] = useState('')

  useEffect(() => saveState(state), [state])

  const stats = useMemo(() => {
    const units = state.lots.reduce((sum, lot) => sum + lot.quantity, 0)
    const cost = state.lots.reduce((sum, lot) => sum + lot.quantity * lot.unitCost, 0)
    const market = state.lots.reduce((sum, lot) => sum + lot.quantity * (lot.marketPrice ?? lot.unitCost), 0)
    const sales = state.transactions.filter((tx) => tx.type === 'sell')
    const revenue = sales.reduce((sum, tx) => sum + tx.quantity * tx.unitPrice, 0)
    const profit = sales.reduce((sum, tx) => sum + tx.quantity * (tx.unitPrice - tx.unitCost), 0)
    const buys = state.transactions.filter((tx) => tx.type === 'buy').reduce((sum, tx) => sum + tx.quantity * tx.unitPrice, 0)
    return { units, cost, market, revenue, profit, buys }
  }, [state])

  const filteredLots = state.lots.filter((lot) => `${lot.name} ${lot.number} ${lot.setName}`.toLowerCase().includes(inventoryFilter.toLowerCase()))

  function recordBuy(card: CardResult, quantity: number, unitCost: number, condition: Condition) {
    const lotId = crypto.randomUUID()
    const timestamp = new Date().toISOString()
    const lot: InventoryLot = { ...card, lotId, quantity, unitCost, condition, addedAt: timestamp }
    const tx: Transaction = { id: crypto.randomUUID(), type: 'buy', cardId: card.id, lotId, cardName: card.name, cardNumber: card.number, setName: card.setName, condition, quantity, unitPrice: unitCost, unitCost, timestamp }
    setState((current) => ({ ...current, lots: [lot, ...current.lots], transactions: [tx, ...current.transactions] }))
  }

  function recordSale(lot: InventoryLot, quantity: number, unitPrice: number) {
    const tx: Transaction = { id: crypto.randomUUID(), type: 'sell', cardId: lot.id, lotId: lot.lotId, cardName: lot.name, cardNumber: lot.number, setName: lot.setName, condition: lot.condition, quantity, unitPrice, unitCost: lot.unitCost, timestamp: new Date().toISOString() }
    setState((current) => ({
      ...current,
      lots: current.lots.map((item) => item.lotId === lot.lotId ? { ...item, quantity: item.quantity - quantity } : item).filter((item) => item.quantity > 0),
      transactions: [tx, ...current.transactions],
    }))
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setTab('overview')} aria-label="Go to overview">
          <span className="brand-mark"><BarChart3 size={19} /></span>
          <span><strong>Tabletop</strong> Ledger</span>
        </button>
        <div className="show-pill">
          <span className="live-dot" />
          <div><span>Active show</span><strong>{state.showName}</strong></div>
          <ChevronDown size={16} />
        </div>
        <nav>
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
          <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>Inventory <span>{stats.units}</span></button>
          <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Activity</button>
        </nav>
        <button className="icon-button" aria-label="Settings"><Settings size={19} /></button>
        <button className="mobile-menu" aria-label="Menu"><Menu size={22} /></button>
      </header>

      <main>
        {tab === 'overview' && <Overview state={state} stats={stats} onBuy={() => setFlow('buy')} onSell={() => setFlow('sell')} onTab={setTab} />}
        {tab === 'inventory' && <Inventory lots={filteredLots} total={state.lots.length} filter={inventoryFilter} setFilter={setInventoryFilter} onBuy={() => setFlow('buy')} onSell={() => setFlow('sell')} />}
        {tab === 'activity' && <Activity transactions={state.transactions} />}
      </main>

      <div className="mobile-actions">
        <button className="buy" onClick={() => setFlow('buy')}><ArrowDownLeft /> Buy</button>
        <button className="sell" onClick={() => setFlow('sell')}><ArrowUpRight /> Sell</button>
      </div>

      {flow && <TransactionModal flow={flow} lots={state.lots} onClose={() => setFlow(null)} onBuy={recordBuy} onSell={recordSale} />}
    </div>
  )
}

function Overview({ state, stats, onBuy, onSell, onTab }: { state: LedgerState; stats: Stats; onBuy: () => void; onSell: () => void; onTab: (tab: 'inventory' | 'activity') => void }) {
  const margin = stats.revenue ? (stats.profit / stats.revenue) * 100 : 0
  return <>
    <section className="hero-row">
      <div><p className="eyebrow">SHOW COMMAND CENTER</p><h1>Keep the table moving.</h1><p>Every card, cost, and deal—captured while it happens.</p></div>
      <div className="desktop-actions"><button className="action buy" onClick={onBuy}><ArrowDownLeft /> Record buy</button><button className="action sell" onClick={onSell}><ArrowUpRight /> Record sale</button></div>
    </section>
    <section className="stat-grid">
      <StatCard label="Realized profit" value={money.format(stats.profit)} detail={`${margin.toFixed(1)}% margin`} icon={<CircleDollarSign />} tone="profit" />
      <StatCard label="Sales revenue" value={money.format(stats.revenue)} detail={`${state.transactions.filter((tx) => tx.type === 'sell').length} sales`} icon={<ArrowUpRight />} />
      <StatCard label="Inventory value" value={money.format(stats.market)} detail={`${stats.units} cards on hand`} icon={<Box />} />
      <StatCard label="Cash spent" value={money.format(stats.buys)} detail={`${state.transactions.filter((tx) => tx.type === 'buy').length} buys today`} icon={<ArrowDownLeft />} />
    </section>
    <section className="content-grid">
      <div className="panel">
        <div className="panel-heading"><div><p className="eyebrow">RECENT MOVEMENT</p><h2>Show activity</h2></div><button className="text-button" onClick={() => onTab('activity')}>View all</button></div>
        {state.transactions.length ? <div className="activity-list">{state.transactions.slice(0, 5).map((tx) => <ActivityRow key={tx.id} tx={tx} />)}</div> : <EmptyActivity onBuy={onBuy} onSell={onSell} />}
      </div>
      <div className="panel inventory-glance">
        <div className="panel-heading"><div><p className="eyebrow">AT A GLANCE</p><h2>Inventory</h2></div><button className="text-button" onClick={() => onTab('inventory')}>Manage</button></div>
        <div className="value-block"><span>Total cost basis</span><strong>{money.format(stats.cost)}</strong><small>Potential spread <b>+{money.format(Math.max(0, stats.market - stats.cost))}</b></small></div>
        <div className="mini-list">{state.lots.slice(0, 3).map((lot) => <div key={lot.lotId}><CardThumb lot={lot} /><span><strong>{lot.name}</strong><small>{lot.setCode} · #{lot.number}</small></span><b>×{lot.quantity}</b></div>)}</div>
      </div>
    </section>
  </>
}

function StatCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: React.ReactNode; tone?: string }) {
  return <article className={`stat-card ${tone ?? ''}`}><div className="stat-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{detail}</small></article>
}

function EmptyActivity({ onBuy, onSell }: { onBuy: () => void; onSell: () => void }) {
  return <div className="empty-state"><span><Sparkles /></span><h3>Your show ledger is ready</h3><p>Record your first deal to start seeing profit and activity here.</p><div><button onClick={onBuy}>Record a buy</button><button onClick={onSell}>Record a sale</button></div></div>
}

function Inventory({ lots, total, filter, setFilter, onBuy, onSell }: { lots: InventoryLot[]; total: number; filter: string; setFilter: (s: string) => void; onBuy: () => void; onSell: () => void }) {
  return <>
    <section className="page-title"><div><p className="eyebrow">YOUR STOCK</p><h1>Inventory</h1><p>{total} lots, organized by acquisition cost.</p></div><div className="desktop-actions"><button className="action buy" onClick={onBuy}><Plus /> Add cards</button><button className="action sell" onClick={onSell}><ArrowUpRight /> Record sale</button></div></section>
    <div className="search-bar"><Search /><input aria-label="Filter inventory" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search inventory by card, set, or number…" />{filter && <button onClick={() => setFilter('')}><X /></button>}</div>
    <section className="inventory-table panel">
      <div className="table-head"><span>Card</span><span>Condition</span><span>Qty.</span><span>Unit cost</span><span>Market</span><span>Potential</span></div>
      {lots.map((lot) => <div className="table-row" key={lot.lotId}><div className="card-cell"><CardThumb lot={lot} /><span><strong>{lot.name}</strong><small>{lot.setName} · #{lot.number}</small></span></div><span className="condition">{lot.condition}</span><b>{lot.quantity}</b><span>{money.format(lot.unitCost)}</span><span>{lot.marketPrice ? money.format(lot.marketPrice) : '—'}</span><span className={(lot.marketPrice ?? 0) >= lot.unitCost ? 'positive' : 'negative'}>{lot.marketPrice ? money.format((lot.marketPrice - lot.unitCost) * lot.quantity) : '—'}</span></div>)}
      {!lots.length && <div className="empty-row"><PackageOpen /><h3>No cards found</h3><p>Try another search or add a card to inventory.</p></div>}
    </section>
  </>
}

function Activity({ transactions }: { transactions: Transaction[] }) {
  return <><section className="page-title"><div><p className="eyebrow">COMPLETE LEDGER</p><h1>Activity</h1><p>A record of every buy and sale at this show.</p></div></section><section className="panel activity-page">{transactions.length ? transactions.map((tx) => <ActivityRow key={tx.id} tx={tx} />) : <div className="empty-row"><ShoppingBag /><h3>No deals yet</h3><p>Your show transactions will appear here.</p></div>}</section></>
}

function ActivityRow({ tx }: { tx: Transaction }) {
  const total = tx.quantity * tx.unitPrice
  const profit = tx.type === 'sell' ? tx.quantity * (tx.unitPrice - tx.unitCost) : null
  return <div className="activity-row"><span className={`flow-icon ${tx.type}`}>{tx.type === 'sell' ? <ArrowUpRight /> : <ArrowDownLeft />}</span><div><strong>{tx.type === 'sell' ? 'Sold' : 'Bought'} {tx.quantity}× {tx.cardName}</strong><small>{tx.setName} · #{tx.cardNumber} · {tx.condition}</small></div><time>{new Date(tx.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><span className="tx-total"><strong>{tx.type === 'sell' ? '+' : '−'}{money.format(total)}</strong>{profit !== null && <small className={profit >= 0 ? 'positive' : 'negative'}>{profit >= 0 ? '+' : '−'}{money.format(Math.abs(profit))} profit</small>}</span></div>
}

function CardThumb({ lot }: { lot: Pick<InventoryLot, 'image' | 'name'> }) { return lot.image ? <img className="card-thumb" src={lot.image} alt="" /> : <span className="card-thumb fallback">{lot.name[0]}</span> }

function TransactionModal({ flow, lots, onClose, onBuy, onSell }: { flow: Flow; lots: InventoryLot[]; onClose: () => void; onBuy: (card: CardResult, quantity: number, price: number, condition: Condition) => void; onSell: (lot: InventoryLot, quantity: number, price: number) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardResult[]>([])
  const [selectedCard, setSelectedCard] = useState<CardResult | null>(null)
  const [selectedLot, setSelectedLot] = useState<InventoryLot | null>(null)
  const [loading, setLoading] = useState(false)
  const [offline, setOffline] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [price, setPrice] = useState('')
  const [condition, setCondition] = useState<Condition>('NM')

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

  const inventoryResults = lots.filter((lot) => `${lot.name} ${lot.number} ${lot.setName} ${lot.setCode}`.toLowerCase().includes(query.toLowerCase()))
  const visibleResults = flow === 'buy' ? (query.trim().length >= 2 ? results : []) : (query.trim() ? inventoryResults : [])
  const chosen = flow === 'buy' ? selectedCard : selectedLot
  const valid = chosen && quantity > 0 && Number(price) >= 0 && (flow === 'buy' || quantity <= (selectedLot?.quantity ?? 0))

  function chooseCard(card: CardResult) { setSelectedCard(card); setPrice(card.marketPrice?.toFixed(2) ?? '') }
  function chooseLot(lot: InventoryLot) { setSelectedLot(lot); setCondition(lot.condition); setPrice((lot.marketPrice ?? lot.unitCost).toFixed(2)) }
  function submit() {
    if (!valid) return
    if (flow === 'buy' && selectedCard) onBuy(selectedCard, quantity, Number(price), condition)
    if (flow === 'sell' && selectedLot) onSell(selectedLot, quantity, Number(price))
    onClose()
  }

  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal" role="dialog" aria-modal="true">
    <div className="modal-head"><div><p className="eyebrow">{flow === 'buy' ? 'INCOMING INVENTORY' : 'OUTGOING INVENTORY'}</p><h2>{flow === 'buy' ? 'Record a buy' : 'Record a sale'}</h2></div><button onClick={onClose}><X /></button></div>
    {!chosen ? <div className="finder">
      <label>{flow === 'buy' ? 'Find the card' : 'Find it in inventory'}</label>
      <div className="search-bar"><Search /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={flow === 'buy' ? 'Try “Froakie 060” or “060”…' : 'Search your cards…'} />{loading && <span className="spinner" />}</div>
      {offline && <p className="notice">Live catalog unavailable—showing offline matches.</p>}
      {!query && <div className="search-prompt"><Search /><h3>Search by name or number</h3><p>{flow === 'buy' ? 'We’ll look across the Pokémon TCG catalog.' : 'Choose the exact inventory lot you sold from.'}</p></div>}
      <div className="result-list">{visibleResults.map((item) => {
        const lot = item as InventoryLot
        return <button key={flow === 'buy' ? item.id : lot.lotId} onClick={() => flow === 'buy' ? chooseCard(item) : chooseLot(lot)}><CardThumb lot={item} /><span><strong>{item.name} <small>#{item.number}</small></strong><small>{item.setName} · {item.setCode}{flow === 'sell' ? ` · ${lot.condition} · ${lot.quantity} available` : ''}</small></span><b>{item.marketPrice ? money.format(item.marketPrice) : 'Select'}</b></button>
      })}</div>
      {query.length >= 2 && !loading && visibleResults.length === 0 && <div className="search-prompt compact"><PackageOpen /><h3>No matches yet</h3><p>Check the spelling or try only the collector number.</p></div>}
    </div> : <div className="deal-form">
      <button className="selected-card" onClick={() => flow === 'buy' ? setSelectedCard(null) : setSelectedLot(null)}><CardThumb lot={chosen} /><span><strong>{chosen.name} <small>#{chosen.number}</small></strong><small>{chosen.setName}</small></span><em>Change</em></button>
      <div className="form-grid"><label>Condition<select value={condition} onChange={(e) => setCondition(e.target.value as Condition)} disabled={flow === 'sell'}>{conditions.map((c) => <option key={c}>{c}</option>)}</select></label><label>Quantity<div className="quantity-input"><button onClick={() => setQuantity(Math.max(1, quantity - 1))}><Minus /></button><input value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} type="number" min="1" /><button onClick={() => setQuantity(Math.min(selectedLot?.quantity ?? 99, quantity + 1))}><Plus /></button></div></label><label className="price-label">{flow === 'buy' ? 'Cost per card' : 'Sale price per card'}<div className="money-input"><span>$</span><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" /></div></label></div>
      {flow === 'sell' && selectedLot && <div className="profit-preview"><span>Estimated profit</span><strong className={Number(price) >= selectedLot.unitCost ? 'positive' : 'negative'}>{money.format(quantity * (Number(price || 0) - selectedLot.unitCost))}</strong><small>Cost basis: {money.format(quantity * selectedLot.unitCost)}</small></div>}
      <button className={`submit-deal ${flow}`} disabled={!valid} onClick={submit}><Check /> {flow === 'buy' ? `Add ${quantity} to inventory` : `Complete ${money.format(quantity * Number(price || 0))} sale`}</button>
    </div>}
  </div></div>
}

export default App
