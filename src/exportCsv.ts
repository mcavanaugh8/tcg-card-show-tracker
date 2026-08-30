import type { LedgerState } from './types'

const columns = ['show_name', 'show_date', 'record_type', 'transaction_type', 'card_name', 'card_number', 'set_name', 'variant', 'card_format', 'grading_company', 'grade', 'certification_number', 'condition', 'quantity', 'unit_cost', 'unit_price', 'market_price', 'market_price_source', 'total', 'profit', 'notes', 'timestamp'] as const

function escapeCsv(value: string | number | undefined) {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function exportLedgerCsv(state: LedgerState) {
  const inventoryRows = state.lots.map((lot) => {
    const marketPrice = lot.marketPriceOverride ?? lot.marketPrice
    const marketSource = lot.marketPriceOverride !== undefined ? 'manual' : lot.marketPrice !== undefined ? 'api' : ''
    return [
      state.showName, state.showDate, 'inventory', '', lot.name, lot.number, lot.setName,
      lot.variant ?? 'Unspecified', lot.cardFormat ?? 'raw', lot.gradingCompany, lot.grade, lot.certificationNumber,
      lot.condition, lot.quantity, lot.unitCost.toFixed(2), '', marketPrice?.toFixed(2), marketSource,
      (lot.quantity * lot.unitCost).toFixed(2), '', lot.notes, lot.addedAt,
    ]
  })
  const transactionRows = state.transactions.map((transaction) => [
    state.showName, state.showDate, 'transaction', transaction.type, transaction.cardName,
    transaction.cardNumber, transaction.setName, transaction.variant ?? 'Unspecified', transaction.cardFormat ?? 'raw',
    transaction.gradingCompany, transaction.grade, transaction.certificationNumber, transaction.condition, transaction.quantity,
    transaction.unitCost.toFixed(2), transaction.unitPrice.toFixed(2), '', '',
    (transaction.quantity * transaction.unitPrice).toFixed(2),
    transaction.type === 'sell' ? (transaction.quantity * (transaction.unitPrice - transaction.unitCost)).toFixed(2) : '',
    '', transaction.timestamp,
  ])
  const tradeRows = (state.trades ?? []).flatMap((trade) => [
    ...trade.outgoing.map((line) => [
      state.showName, state.showDate, 'trade', 'trade-out', line.cardName, line.cardNumber, line.setName,
      line.variant, line.cardFormat ?? 'raw', line.gradingCompany, line.grade, line.certificationNumber, line.condition, line.quantity, line.unitCost.toFixed(2), line.unitTradeValue.toFixed(2), '', '',
      (line.quantity * line.unitTradeValue).toFixed(2), '',
      `Trade ${trade.id}; basis carried forward; cash paid ${trade.cashPaid.toFixed(2)}; cash received ${trade.cashReceived.toFixed(2)}`, trade.timestamp,
    ]),
    ...trade.incoming.map((line) => [
      state.showName, state.showDate, 'trade', 'trade-in', line.cardName, line.cardNumber, line.setName,
      line.variant, line.cardFormat ?? 'raw', line.gradingCompany, line.grade, line.certificationNumber, line.condition, line.quantity, line.unitCost.toFixed(2), line.unitTradeValue.toFixed(2), '', '',
      (line.quantity * line.unitTradeValue).toFixed(2), '', `Trade ${trade.id}`, trade.timestamp,
    ]),
  ])
  const csv = [columns, ...inventoryRows, ...transactionRows, ...tradeRows].map((row) => row.map(escapeCsv).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `tabletop-ledger-${state.showDate || 'export'}.csv`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
