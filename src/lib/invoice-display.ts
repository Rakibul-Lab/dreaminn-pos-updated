import { formatPaymentMethod } from '@/lib/payment-method'
import { parseBookingDiscountType } from '@/lib/booking-discount'

export const INVOICE_MUSHAK = 'Mushak-6.3'
export const INVOICE_BIN = '006985415-1105'
export const INVOICE_HOTEL_ADDRESS =
  '6th floor, RRP Center, Post office More, Ishwardi, Pabna.'
export const INVOICE_HOTEL_ADDRESS_LINES = [
  '6th floor, RRP Center,',
  'Post office More, Ishwardi, Pabna.',
] as const
export const INVOICE_HOTEL_MOBILE = '01335107200'
export const INVOICE_RESTAURANT_ADDRESS =
  '13th Floor, RRP Center, Post Office More, Ishwardi, Pabna-6620'
export const INVOICE_RESTAURANT_MOBILE = '+88 01335075210'
export const INVOICE_RESTAURANT_MUSHAK = 'Mushak: 6.3'
export const INVOICE_SD_PERCENT = 0
export const INVOICE_VAT_PERCENT = 15
export const INVOICE_SERVICE_CHARGE_PERCENT = 10

export type InvoiceChargeDisplayRow = {
  id: string
  date: string
  time: string
  category: string
  description: string
  /** Gross / total rent shown in the Room Rent column (taxes derived in background). */
  roomRent: number
  sdAmount: number
  vatAmount: number
  serviceChargeAmount: number
  discountLabel: string
  discountAmount: number
  amount: number
}

export function calcPercentAmount(base: number, percent: number): number {
  if (!percent || percent <= 0 || base <= 0) return 0
  return Math.round((base * percent) / 100)
}

export type DecomposedGrossRent = {
  /** Guest-facing total (e.g. rate × nights = ৳28,000). */
  grossRent: number
  /** Net base before SD, VAT & service (e.g. ৳22,400). */
  baseRent: number
  sdAmount: number
  vatAmount: number
  serviceChargeAmount: number
}

/**
 * Gross rent is SD-, VAT- and service-inclusive. Back out base so that
 * base + SD + VAT + service = gross (e.g. ৳28,000 → base ৳22,400 at 0% SD).
 */
export function decomposeGrossRentWithVatAndService(
  grossRent: number,
  vatPercent: number = INVOICE_VAT_PERCENT,
  servicePercent: number = INVOICE_SERVICE_CHARGE_PERCENT,
  sdPercent: number = INVOICE_SD_PERCENT
): DecomposedGrossRent {
  if (grossRent <= 0) {
    return { grossRent: 0, baseRent: 0, sdAmount: 0, vatAmount: 0, serviceChargeAmount: 0 }
  }

  const divisor = 1 + sdPercent / 100 + vatPercent / 100 + servicePercent / 100
  const baseRent = Math.round(grossRent / divisor)
  const sdAmount = calcPercentAmount(baseRent, sdPercent)
  const vatAmount = calcPercentAmount(baseRent, vatPercent)
  let serviceChargeAmount = calcPercentAmount(baseRent, servicePercent)
  const componentsSum = baseRent + sdAmount + vatAmount + serviceChargeAmount
  if (componentsSum !== grossRent) {
    serviceChargeAmount += grossRent - componentsSum
  }

  return { grossRent, baseRent, sdAmount, vatAmount, serviceChargeAmount }
}

/** Apply discount to gross first, then back out SD / VAT / service on the reduced total. */
export function decomposeGrossAfterDiscount(
  grossRent: number,
  discountAmount: number,
  vatPercent: number = INVOICE_VAT_PERCENT,
  servicePercent: number = INVOICE_SERVICE_CHARGE_PERCENT,
  sdPercent: number = INVOICE_SD_PERCENT
): DecomposedGrossRent & { discountAmount: number; discountedGross: number } {
  const appliedDiscount = Math.max(0, discountAmount)
  const discountedGross = Math.max(0, grossRent - appliedDiscount)
  const decomposed = decomposeGrossRentWithVatAndService(
    discountedGross,
    vatPercent,
    servicePercent,
    sdPercent
  )
  return {
    ...decomposed,
    grossRent,
    discountAmount: appliedDiscount,
    discountedGross,
  }
}

export const INVOICE_ZERO_DISCOUNT_DISPLAY = '0.0'

export function formatDiscountLabel(
  type: 'PERCENTAGE' | 'FIXED',
  value: number,
  amount: number
): string {
  if (amount <= 0) return INVOICE_ZERO_DISCOUNT_DISPLAY
  if (type === 'PERCENTAGE' && value > 0) return `${value}%`
  return 'Discount'
}

/** Column heading for charge tables — percentage in header, not in the amount cell. */
export function formatDiscountColumnHeading(
  type: 'PERCENTAGE' | 'FIXED',
  value: number,
  hasDiscount: boolean
): string {
  if (!hasDiscount) return 'Discount'
  if (type === 'PERCENTAGE' && value > 0) return `Discount (${value}%)`
  return 'Discount'
}

export function formatInvoiceDiscountCell(amount: number): string {
  if (amount <= 0) return INVOICE_ZERO_DISCOUNT_DISPLAY
  return amount.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export function buildChargeDisplayRow(
  row: Omit<InvoiceChargeDisplayRow, 'amount'> & { amount?: number }
): InvoiceChargeDisplayRow {
  const amount = row.amount ?? Math.max(0, row.roomRent - row.discountAmount)
  return { ...row, amount }
}

export function sumChargeRowAmounts(rows: InvoiceChargeDisplayRow[]): number {
  return rows.reduce((sum, row) => sum + row.amount, 0)
}

export type InvoicePaymentSummary = {
  byMethod: Array<{ label: string; amount: number }>
  totalPaid: number
  due: number
}

export function sumPaymentsByMethod(
  payments: Array<{ method: string; amount: number }>,
  method: string
): number {
  return payments
    .filter((p) => p.method === method && p.amount > 0)
    .reduce((sum, p) => sum + p.amount, 0)
}

export function buildInvoicePaymentSummary(input: {
  payments: Array<{ method: string; amount: number }>
  paidAmount: number
  totalAmount: number
  dueAmount: number
}): InvoicePaymentSummary {
  const byMethodMap = new Map<string, number>()
  for (const payment of input.payments) {
    if (payment.amount <= 0) continue
    const label = formatPaymentMethod(payment.method)
    const suffix = label.toLowerCase().includes('payment') ? label : `${label} Payment`
    byMethodMap.set(suffix, (byMethodMap.get(suffix) ?? 0) + payment.amount)
  }

  const totalPaid = input.paidAmount

  return {
    byMethod: Array.from(byMethodMap.entries()).map(([label, amount]) => ({ label, amount })),
    totalPaid,
    due: input.dueAmount,
  }
}

export function resolveInvoiceDiscountMeta(booking?: {
  discountEnabled?: boolean
  discountType?: string | null
  discountValue?: number | null
} | null) {
  const enabled = booking?.discountEnabled === true
  const type = parseBookingDiscountType(booking?.discountType)
  const value = enabled ? Math.max(0, Number(booking?.discountValue) || 0) : 0
  return { enabled, type, value }
}

/** Hotel room VAT % for invoice display (inclusive rates still carry VAT at this rate). */
export function resolveInvoiceHotelVatPercent(booking?: {
  vatApplied?: boolean | null
  vatPercent?: number | null
} | null): number {
  if (booking?.vatPercent != null && booking.vatPercent > 0) {
    return booking.vatPercent
  }
  return INVOICE_VAT_PERCENT
}

/** Room VAT on invoice summary when stored invoice.vatAmount omits inclusive room VAT. */
export function resolveInvoiceRoomVatAmount(input: {
  invoiceVatAmount: number
  restaurantVat: number
  roomCharges: number
  discount: number
  booking?: {
    vatApplied?: boolean | null
    vatPercent?: number | null
    serviceChargePercent?: number | null
  } | null
}): number {
  const fromInvoice = Math.max(0, input.invoiceVatAmount - input.restaurantVat)
  if (fromInvoice > 0) return Math.round(fromInvoice)

  const gross = input.roomCharges
  if (gross <= 0) return 0

  const vatPercent = resolveInvoiceHotelVatPercent(input.booking)
  const servicePercent = resolveInvoiceHotelServicePercent(input.booking)
  return decomposeGrossAfterDiscount(gross, input.discount, vatPercent, servicePercent).vatAmount
}

/** Service charge % stored on the booking (inclusive room rate decomposition). */
export function resolveInvoiceHotelServicePercent(booking?: {
  serviceChargePercent?: number | null
} | null): number {
  return Math.max(0, booking?.serviceChargePercent ?? INVOICE_SERVICE_CHARGE_PERCENT)
}
