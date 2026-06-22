import { buildPaperSalesLines, computePaperTotals } from '@/lib/daily-sales-paper-format'
import type { DailySalesLine } from '@/lib/daily-sales-report'
import { formatPaymentMethod } from '@/lib/payment-method'

export type HeadOfficeRemittanceRow = {
  id: string
  amount: number
  method: string
  bank: string | null
  reference: string | null
  notes: string | null
  sentBy: string
  at: string
}

export type PaymentColumnTotals = {
  cash: number
  card: number
  mBanking: number
  total: number
}

export type CashReconciliation = {
  /** Opening cash in drawer (from sales report settings). */
  openingCash: number
  /** Sum of the Cash column on the daily sales report. */
  cashCollectedToday: number
  /** Card column totals on the daily sales report. */
  cardCollectedToday: number
  /** M. banking column totals on the daily sales report. */
  mBankingCollectedToday: number
  /** All methods sent to head office today. */
  totalRemitted: number
  /** Cash-only transfers to head office. */
  cashRemitted: number
  /** Card transfers to head office. */
  cardRemitted: number
  /** M. banking transfers to head office (bank, bKash, Nagad, Upay, etc.). */
  mBankingRemitted: number
  /** openingCash + cashCollectedToday − cashRemitted */
  cashOnHand: number
  remittanceCount: number
}

const CARD_DEPOSIT_METHODS = new Set(['CARD'])
const MBANKING_DEPOSIT_METHODS = new Set(['BANK', 'BKASH', 'NAGAD', 'UPAY', 'MOBILE_BANKING'])

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

/** Group head-office deposit amounts into sales-report payment columns. */
export function sumDepositsByPaymentColumn(
  deposits: Array<{ amount: number; method: string }>
): PaymentColumnTotals {
  let cash = 0
  let card = 0
  let mBanking = 0
  for (const deposit of deposits) {
    if (deposit.method === 'CASH') cash += deposit.amount
    else if (CARD_DEPOSIT_METHODS.has(deposit.method)) card += deposit.amount
    else if (MBANKING_DEPOSIT_METHODS.has(deposit.method)) mBanking += deposit.amount
    else mBanking += deposit.amount
  }
  return {
    cash: roundMoney(cash),
    card: roundMoney(card),
    mBanking: roundMoney(mBanking),
    total: roundMoney(cash + card + mBanking),
  }
}

type DepositRecord = {
  id: string
  amount: number
  method: string
  bankName?: string | null
  reference?: string | null
  notes?: string | null
  depositedAt: Date
  depositor: { name: string }
}

/** Cash / card / M. banking totals exactly as printed on the daily sales paper. */
export function computeSalesPaperPaymentTotals(lines: DailySalesLine[]) {
  const paperLines = buildPaperSalesLines(lines)
  const totals = computePaperTotals(paperLines)
  return {
    cash: totals.cash,
    card: totals.card,
    mBanking: totals.mBanking,
  }
}

export function mapHeadOfficeRemittances(deposits: DepositRecord[]): HeadOfficeRemittanceRow[] {
  return deposits.map((deposit) => ({
    id: deposit.id,
    amount: deposit.amount,
    method: formatPaymentMethod(deposit.method),
    bank: deposit.bankName ?? null,
    reference: deposit.reference ?? null,
    notes: deposit.notes ?? null,
    sentBy: deposit.depositor.name,
    at: deposit.depositedAt.toISOString(),
  }))
}

export function computeCashReconciliation(
  openingCash: number,
  salesLines: DailySalesLine[],
  deposits: Array<{ amount: number; method: string }>
): CashReconciliation {
  const { cash, card, mBanking } = computeSalesPaperPaymentTotals(salesLines)
  const remitted = sumDepositsByPaymentColumn(deposits)

  return {
    openingCash,
    cashCollectedToday: cash,
    cardCollectedToday: card,
    mBankingCollectedToday: mBanking,
    totalRemitted: remitted.total,
    cashRemitted: remitted.cash,
    cardRemitted: remitted.card,
    mBankingRemitted: remitted.mBanking,
    cashOnHand: openingCash + cash - remitted.cash,
    remittanceCount: deposits.length,
  }
}
