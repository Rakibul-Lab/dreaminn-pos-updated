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
}

export type PaperSalesInput = {
  openingBalance?: number
  lines?: PaperSalesInputLine[]
  balances?: {
    openingBalance?: number
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
}

export function buildPaperSalesLines(lines: PaperSalesInputLine[] | undefined): PaperSalesLine[] {
  return (lines ?? []).map((line) => {
    // For now: keep service charges as 0 in daily paper report.
    // (User will update the logic later.)
    const others = 0
    const company = (line.companyBill ?? 0) > 0 ? line.companyBill! : null
    const cash = (line.cash ?? 0) > 0 ? line.cash! : null
    const card = (line.card ?? 0) > 0 ? line.card! : null
    const mBanking = (line.mbanking ?? 0) > 0 ? line.mbanking! : null
    // Paper format: VAT is only a label. Total is the sum of row columns.
    const total =
      others +
      (cash ?? 0) +
      (card ?? 0) +
      (mBanking ?? 0) +
      (company ?? 0)
    const totalInclVat = total > 0 ? Number(total.toFixed(2)) : null

    return {
      roomNo: line.room ?? '',
      regNo: line.regNo ?? '',
      othersServiceSale: 0,
      cash,
      card,
      mBanking,
      dueBill: company,
      remarks: line.remark ?? '',
      totalInclVat,
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

export function buildPaperSummary(data: PaperSalesInput): PaperSummary {
  const paperLines = buildPaperSalesLines(data.lines)
  const totals = computePaperTotals(paperLines)
  const balances = data.balances ?? {}
  const openingBalance = balances.openingBalance ?? data.openingBalance ?? 0
  const dueBill = balances.companyBillTotal ?? totals.dueBill
  const totalSale = totals.totalInclVat
  const grandTotal = openingBalance + totalSale
  const closingBalance = balances.closingBalance ?? grandTotal - dueBill
  const hotelDiscount = data.hotel?.discount ?? 0
  const restaurantDiscount = data.restaurant?.discount ?? 0
  const totalDiscount =
    data.totalDiscount !== undefined
      ? data.totalDiscount
      : hotelDiscount + restaurantDiscount

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
  }
}

export function paperLineToRow(line: PaperSalesLine): string[] {
  return [
    line.roomNo,
    line.regNo,
    formatPaperAmountAlways(line.othersServiceSale ?? 0),
    formatPaperAmount(line.cash),
    formatPaperAmount(line.card),
    formatPaperAmount(line.mBanking),
    formatPaperAmount(line.dueBill),
    line.remarks,
    line.totalInclVat === null ? '-' : formatPaperAmountAlways(line.totalInclVat),
  ]
}

export function paperTotalsToRow(totals: PaperSalesTotals): string[] {
  return [
    'Total Sale =',
    '',
    formatPaperAmount(totals.othersServiceSale),
    formatPaperAmount(totals.cash),
    formatPaperAmount(totals.card),
    formatPaperAmount(totals.mBanking),
    formatPaperAmount(totals.dueBill),
    '',
    formatPaperAmount(totals.totalInclVat),
  ]
}
