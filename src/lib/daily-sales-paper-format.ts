import { format, parseISO } from 'date-fns'

export const PAPER_SALES_HEADERS = [
  'Room No',
  'Reg. No.',
  'Others Service Sale',
  'Cash',
  'Card',
  'M. Banking',
  'Company',
  'Remarks',
  'Total (incl.15% VAT)',
] as const

export const NOTE_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const

export type PaperSalesLine = {
  roomNo: string
  regNo: string
  othersServiceSale: number | null
  cash: number | null
  card: number | null
  mBanking: number | null
  dueBill: number | null
  remarks: string
  totalInclVat: number | null
  lineType?: 'charge' | 'payment'
}

export type PaperSalesTotals = {
  othersServiceSale: number
  cash: number
  card: number
  mBanking: number
  dueBill: number
  totalInclVat: number
}

export type PaperSummary = {
  totalSale: number
  openingBalance: number
  card: number
  mBanking: number
  dueBill: number
  closingBalance: number
  hotelDiscount: number
  restaurantDiscount: number
  totalDiscount: number
  checkIns: number
  checkOuts: number
  occupiedRooms: number
  cashCollectedToday: number
  cardCollectedToday: number
  mBankingCollectedToday: number
  cashSentToHeadOffice: number
  cardSentToHeadOffice: number
  mBankingSentToHeadOffice: number
  cashOnHand: number
  totalSentToHeadOffice: number
  hotelBills: number
  restaurantBills: number
  transportBills: number
}

export function formatPaperDate(businessDate: string, businessDateDisplay?: string): string {
  if (businessDateDisplay) return businessDateDisplay
  try {
    return format(parseISO(businessDate), 'dd-MMM-yy')
  } catch {
    return businessDate
  }
}

export function formatPaperAmount(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return '-'
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function formatPaperAmountAlways(value: number, decimals = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export type PaperSalesInputLine = {
  room?: string | null
  regNo?: string | null
  roomAmount?: number
  otherService?: number
  cash?: number
  card?: number
  mbanking?: number
  companyBill?: number
  remark?: string | null
  total?: number
  lineType?: 'charge' | 'payment'
  source?: 'invoice' | 'restaurant' | 'beverage' | 'transport' | 'guest-restaurant-bill' | 'payment'
}

export type PaperSalesInput = {
  openingBalance?: number
  lines?: PaperSalesInputLine[]
  balances?: {
    openingBalance?: number
    salesTotal?: number
    companyBillTotal?: number
    closingBalance?: number
  }
  summary?: {
    checkIns?: number
    checkOuts?: number
    occupiedRooms?: number
  }
  hotel?: {
    discount?: number
  }
  restaurant?: {
    discount?: number
  }
  totalDiscount?: number
  billBreakdown?: {
    hotelBills?: number
    restaurantBills?: number
    transportBills?: number
  }
  cashReconciliation?: {
    openingCash?: number
    cashCollectedToday?: number
    cardCollectedToday?: number
    mBankingCollectedToday?: number
    cashRemitted?: number
    cardRemitted?: number
    mBankingRemitted?: number
    cashOnHand?: number
    totalRemitted?: number
  }
}

export function resolveChargeLineTotal(
  grossTotal: number,
  allocation: {
    companyBill?: number
    cash?: number
    card?: number
    mbanking?: number
  }
): number {
  const companyBill = allocation.companyBill ?? 0
  const cash = allocation.cash ?? 0
  const card = allocation.card ?? 0
  const mbanking = allocation.mbanking ?? 0
  const columnSum = companyBill + cash + card + mbanking
  if (columnSum > 0.005) {
    return Number(columnSum.toFixed(2))
  }
  if (grossTotal > 0) {
    return Number(grossTotal.toFixed(2))
  }
  return 0
}

export function buildPaperSalesLines(lines: PaperSalesInputLine[] | undefined): PaperSalesLine[] {
  return (lines ?? []).map((line) => {
    // Others Service Sale column is intentionally left empty for now.
    const company = (line.companyBill ?? 0) > 0 ? line.companyBill! : null
    const cashRaw = line.cash ?? 0
    const cardRaw = line.card ?? 0
    const mBankingRaw = line.mbanking ?? 0
    const cash = cashRaw !== 0 ? cashRaw : null
    const card = cardRaw !== 0 ? cardRaw : null
    const mBanking = mBankingRaw !== 0 ? mBankingRaw : null
    const columnSum =
      (cash ?? 0) + (card ?? 0) + (mBanking ?? 0) + (company ?? 0)
    const lineTotal = line.total ?? 0
    let totalInclVat: number | null = null
    if (line.lineType === 'charge') {
      if (columnSum > 0) {
        totalInclVat = Number(columnSum.toFixed(2))
      } else if (lineTotal !== 0) {
        totalInclVat = Number(lineTotal.toFixed(2))
      }
    } else if (columnSum !== 0) {
      totalInclVat = Number(columnSum.toFixed(2))
    } else if (lineTotal !== 0) {
      totalInclVat = Number(lineTotal.toFixed(2))
    }

    let displayCash = cash
    let displayCard = card
    let displayMBanking = mBanking
    if (
      line.lineType === 'charge' &&
      lineTotal > 0 &&
      columnSum > 0 &&
      Math.abs(columnSum - lineTotal) > 0.01
    ) {
      const methodCount = [cash, card, mBanking].filter((value) => (value ?? 0) !== 0).length
      if (methodCount === 1) {
        if ((cash ?? 0) !== 0) displayCash = lineTotal
        else if ((card ?? 0) !== 0) displayCard = lineTotal
        else displayMBanking = lineTotal
      }
    }

    return {
      roomNo: line.room ?? '',
      regNo: line.regNo ?? '',
      othersServiceSale: null,
      cash: displayCash,
      card: displayCard,
      mBanking: displayMBanking,
      dueBill: company,
      remarks: line.remark ?? '',
      totalInclVat,
      lineType: line.lineType,
    }
  })
}

export function computePaperTotals(paperLines: PaperSalesLine[]): PaperSalesTotals {
  return paperLines.reduce(
    (acc, line) => ({
      othersServiceSale: acc.othersServiceSale + (line.othersServiceSale ?? 0),
      cash: acc.cash + (line.cash ?? 0),
      card: acc.card + (line.card ?? 0),
      mBanking: acc.mBanking + (line.mBanking ?? 0),
      dueBill: acc.dueBill + (line.dueBill ?? 0),
      totalInclVat: acc.totalInclVat + (line.totalInclVat ?? 0),
    }),
    {
      othersServiceSale: 0,
      cash: 0,
      card: 0,
      mBanking: 0,
      dueBill: 0,
      totalInclVat: 0,
    }
  )
}

/** Charge totals by origin: hotel (invoices + beverage) vs restaurant (POS + guest bills). */
export function computeBillBreakdown(
  lines: PaperSalesInputLine[] | undefined
): { hotelBills: number; restaurantBills: number; transportBills: number } {
  let hotelBills = 0
  let restaurantBills = 0
  let transportBills = 0
  for (const line of lines ?? []) {
    if (line.lineType !== 'charge') continue
    const total = resolveChargeLineTotal(line.total ?? 0, line)
    if (total <= 0) continue
    if (line.source === 'invoice' || line.source === 'beverage') {
      hotelBills += total
    } else if (line.source === 'transport') {
      transportBills += total
    } else if (line.source === 'restaurant' || line.source === 'guest-restaurant-bill') {
      restaurantBills += total
    }
  }
  return {
    hotelBills: Number(hotelBills.toFixed(2)),
    restaurantBills: Number(restaurantBills.toFixed(2)),
    transportBills: Number(transportBills.toFixed(2)),
  }
}

export function buildPaperSummary(data: PaperSalesInput): PaperSummary {
  const paperLines = buildPaperSalesLines(data.lines)
  const totals = computePaperTotals(paperLines)
  const balances = data.balances ?? {}
  const openingBalance = balances.openingBalance ?? data.openingBalance ?? 0
  const dueBill = balances.companyBillTotal ?? totals.dueBill
  // Total Sale must foot with Cash + Card + M. Banking + Company on the paper.
  // Do not use balances.salesTotal when tenders exist — that previously added full
  // checkout invoice totals (including prior-day advances) and overstated the day.
  const footedTenders =
    totals.cash + totals.card + totals.mBanking + totals.dueBill + totals.othersServiceSale
  const totalSale = Number(
    (
      footedTenders > 0
        ? footedTenders
        : totals.totalInclVat > 0
          ? totals.totalInclVat
          : (balances.salesTotal ?? 0)
    ).toFixed(2)
  )
  const grandTotal = openingBalance + totalSale
  const closingBalance = balances.closingBalance ?? grandTotal - dueBill
  const hotelDiscount = data.hotel?.discount ?? 0
  const restaurantDiscount = data.restaurant?.discount ?? 0
  const totalDiscount =
    data.totalDiscount !== undefined
      ? data.totalDiscount
      : hotelDiscount + restaurantDiscount

  const cashCollectedToday =
    data.cashReconciliation?.cashCollectedToday ?? totals.cash
  const cardCollectedToday =
    data.cashReconciliation?.cardCollectedToday ?? totals.card
  const mBankingCollectedToday =
    data.cashReconciliation?.mBankingCollectedToday ?? totals.mBanking
  const cashSentToHeadOffice = data.cashReconciliation?.cashRemitted ?? 0
  const cardSentToHeadOffice = data.cashReconciliation?.cardRemitted ?? 0
  const mBankingSentToHeadOffice = data.cashReconciliation?.mBankingRemitted ?? 0
  const totalSentToHeadOffice = data.cashReconciliation?.totalRemitted ?? 0
  const cashOnHand =
    data.cashReconciliation?.cashOnHand ??
    openingBalance + cashCollectedToday - cashSentToHeadOffice

  const { hotelBills, restaurantBills, transportBills } =
    data.billBreakdown ??
    computeBillBreakdown(data.lines)

  return {
    totalSale,
    openingBalance,
    card: totals.card,
    mBanking: totals.mBanking,
    dueBill,
    closingBalance,
    hotelDiscount,
    restaurantDiscount,
    totalDiscount,
    checkIns: data.summary?.checkIns ?? 0,
    checkOuts: data.summary?.checkOuts ?? 0,
    occupiedRooms: data.summary?.occupiedRooms ?? 0,
    cashCollectedToday,
    cardCollectedToday,
    mBankingCollectedToday,
    cashSentToHeadOffice,
    cardSentToHeadOffice,
    mBankingSentToHeadOffice,
    cashOnHand,
    totalSentToHeadOffice,
    hotelBills,
    restaurantBills,
    transportBills,
  }
}

export function paperLineToRow(line: PaperSalesLine): string[] {
  return [
    line.roomNo,
    line.regNo,
    formatPaperAmount(line.othersServiceSale),
    formatPaperAmount(line.cash),
    formatPaperAmount(line.card),
    formatPaperAmount(line.mBanking),
    formatPaperAmount(line.dueBill),
    line.remarks,
    line.totalInclVat === null ? '-' : formatPaperAmountAlways(line.totalInclVat),
  ]
}

export function paperTotalsToRow(
  totals: PaperSalesTotals,
  chargeSaleTotal?: number
): string[] {
  const footedTenders =
    totals.cash + totals.card + totals.mBanking + totals.dueBill + totals.othersServiceSale
  // Always foot with printed columns when they have activity; avoids stale/overstated
  // chargeSaleTotal (e.g. full invoice incl. prior-day advance).
  const saleTotal =
    footedTenders > 0
      ? footedTenders
      : (chargeSaleTotal ?? totals.totalInclVat)
  return [
    'Total Sale =',
    '',
    formatPaperAmount(totals.othersServiceSale),
    formatPaperAmount(totals.cash),
    formatPaperAmount(totals.card),
    formatPaperAmount(totals.mBanking),
    formatPaperAmount(totals.dueBill),
    '',
    formatPaperAmount(saleTotal),
  ]
}
