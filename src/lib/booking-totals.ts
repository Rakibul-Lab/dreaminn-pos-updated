import {
  computeHotelDiscountAmount,
  parseBookingDiscountType,
  resolveDiscountNights,
  type BookingDiscountInput,
  type BookingStayNightsInput,
} from '@/lib/booking-discount'
import {
  decomposeGrossAfterDiscount,
  INVOICE_SERVICE_CHARGE_PERCENT,
} from '@/lib/invoice-display'
import { filterGuestFolioRestaurantOrders } from '@/lib/restaurant-order-billing'

export const DEFAULT_VAT_PERCENT = 15

/** Keyboard ↑/↓ step for VAT % inputs (14 → 14.1 → 14.2). */
export const VAT_PERCENT_INPUT_STEP = 0.1

export type BookingVatOptions = {
  vatApplied?: boolean
  vatPercent?: number
}

function effectiveVatRate(options?: number | BookingVatOptions): number {
  if (typeof options === 'number') {
    return Math.max(0, options)
  }
  const applied = options?.vatApplied !== false
  if (!applied) return 0
  const rate = options?.vatPercent ?? DEFAULT_VAT_PERCENT
  return Math.max(0, rate)
}

/** Room charge + VAT totals for reservations (room only, before extras/restaurant). */
export function computeRoomBookingTotals(
  totalRoomCharge: number,
  totalPaid: number,
  vatOptions?: number | BookingVatOptions,
  discount?: BookingDiscountInput
) {
  const rate = effectiveVatRate(vatOptions)
  const vatApplied = rate > 0
  const discountAmount = computeHotelDiscountAmount(
    totalRoomCharge,
    discount?.discountEnabled === true,
    parseBookingDiscountType(discount?.discountType),
    Number(discount?.discountValue) || 0,
    resolveDiscountNights(discount)
  )
  const taxableRoom = Math.max(0, totalRoomCharge - discountAmount)
  const vatAmount = (taxableRoom * rate) / 100
  const totalWithVat = taxableRoom + vatAmount
  const dueAmount = Math.max(0, totalWithVat - totalPaid)
  return {
    vatApplied,
    vatPercent: rate,
    discountAmount,
    vatAmount,
    totalWithVat,
    dueAmount,
  }
}

/** Hotel room VAT % from settings (default 15). */
export async function getHotelVatPercent(): Promise<number> {
  const { getHotelVatPercent: readHotelVat } = await import('@/lib/app-settings')
  return readHotelVat()
}

export function bookingVatOptions(booking: {
  vatApplied?: boolean | null
  vatPercent?: number | null
}): BookingVatOptions {
  return {
    vatApplied: booking.vatApplied !== false,
    vatPercent: booking.vatPercent ?? DEFAULT_VAT_PERCENT,
  }
}

export type BookingVatListDisplay = {
  mode: 'itemized' | 'included'
  percent: number
  amount: number
}

type BookingVatDisplayFields = BookingStayNightsInput & {
  vatApplied?: boolean | null
  vatPercent?: number | null
  serviceChargePercent?: number | null
  totalRoomCharge: number
  discountEnabled?: boolean | null
  discountType?: string | null
  discountValue?: number | null
}

/**
 * VAT amount for display (list, reservation doc). Room rate is often VAT-inclusive;
 * totals/due stay unchanged — this only back-calculates the VAT portion for UI.
 */
export function computeBookingDisplayVat(booking: BookingVatDisplayFields): BookingVatListDisplay {
  const percent =
    booking.vatPercent != null && booking.vatPercent > 0
      ? booking.vatPercent
      : DEFAULT_VAT_PERCENT
  const discount = bookingDiscountInput(booking)
  const discountAmount = computeHotelDiscountAmount(
    booking.totalRoomCharge,
    discount.discountEnabled === true,
    parseBookingDiscountType(discount.discountType),
    Number(discount.discountValue) || 0,
    resolveDiscountNights(discount)
  )
  const includedInRate = booking.vatApplied === false

  if (includedInRate) {
    const servicePercent = booking.serviceChargePercent ?? INVOICE_SERVICE_CHARGE_PERCENT
    const { vatAmount } = decomposeGrossAfterDiscount(
      booking.totalRoomCharge,
      discountAmount,
      percent,
      servicePercent
    )
    return { mode: 'included', percent, amount: vatAmount }
  }

  const taxableRoom = Math.max(0, booking.totalRoomCharge - discountAmount)
  const amount = (taxableRoom * percent) / 100
  return { mode: 'itemized', percent, amount }
}

/** VAT column for bookings list — always shows amount and rate. */
export function resolveBookingVatListDisplay(
  booking: BookingVatDisplayFields & { vatAmount?: number | null }
): BookingVatListDisplay {
  const computed = computeBookingDisplayVat(booking)
  if (computed.amount > 0) return computed

  const stored = Math.max(0, Number(booking.vatAmount) || 0)
  if (stored > 0) {
    return { mode: 'itemized', percent: computed.percent, amount: stored }
  }

  return computed
}

export function bookingDiscountInput(
  booking: BookingStayNightsInput & {
    discountEnabled?: boolean | null
    discountType?: string | null
    discountValue?: number | null
  }
): BookingDiscountInput {
  return {
    discountEnabled: booking.discountEnabled === true,
    discountType: parseBookingDiscountType(booking.discountType),
    discountValue: Math.max(0, Number(booking.discountValue) || 0),
    nights: resolveDiscountNights(booking),
  }
}

type BookingDueFields = BookingStayNightsInput & {
  status?: string | null
  totalRoomCharge: number
  dueAmount?: number
  vatApplied?: boolean | null
  vatPercent?: number | null
  discountEnabled?: boolean | null
  discountType?: string | null
  discountValue?: number | null
}

type InvoiceDueSnapshot = {
  dueAmount: number
  status?: string | null
}

/** Room-only due (reservation / in-house) with discount applied. */
export function computeBookingRoomDue(
  booking: BookingDueFields,
  payments: BookingPaymentRow[]
) {
  const totalPaid = sumBookingNetPaid(payments)
  return computeRoomBookingTotals(
    booking.totalRoomCharge,
    totalPaid,
    bookingVatOptions(booking),
    bookingDiscountInput(booking)
  )
}

/**
 * Due shown in bookings list and detail:
 * - After checkout, invoice due is authoritative (room + F&B + extras − payments).
 * - Before checkout, room charge due with reservation discount.
 */
export function resolveBookingDisplayDue(
  booking: BookingDueFields,
  payments: BookingPaymentRow[],
  latestInvoice?: InvoiceDueSnapshot | null
): number {
  if (
    booking.status === 'CHECKED_OUT' &&
    latestInvoice &&
    latestInvoice.status !== 'CANCELLED'
  ) {
    return Math.max(0, latestInvoice.dueAmount)
  }

  // Folio due includes room charges plus unpaid room-service balance (adjusted at POS).
  if (booking.status === 'CHECKED_IN' && booking.dueAmount != null) {
    return Math.max(0, booking.dueAmount)
  }

  return computeRoomBookingTotals(
    booking.totalRoomCharge,
    sumCheckoutBookingPaid(payments),
    bookingVatOptions(booking),
    bookingDiscountInput(booking)
  ).dueAmount
}

/** Reduce stored folio due when a guest payment is recorded while checked in. */
export function applyBookingPaymentToStoredDue(storedDue: number, paymentAmount: number): number {
  return Math.max(0, storedDue - Math.max(0, paymentAmount))
}

/** Increase stored folio due when a charge is posted to an in-house guest. */
export function applyBookingChargeToStoredDue(storedDue: number, chargeAmount: number): number {
  return Math.max(0, storedDue + Math.max(0, chargeAmount))
}

export type BookingPaymentRow = { amount: number; paymentType: string }

export type BookingChargeRow = { chargeType: string; amount: number; quantity: number }

/** Charge types recorded from Payments → Record New Payment (money taken for a folio extra). */
const MANUAL_CHARGE_PAYMENT_TYPES = new Set(['EXTRA_CHARGES', 'DAMAGE_CHARGES', 'OTHERS'])

/**
 * Extras posted on a stay, from both places they can originate:
 * - `RoomCharge` rows (Send to Room, beverage, laundry, late checkout, damage)
 * - manual charge payments recorded on the Payments page, which post an invoice
 *   line instead of a `RoomCharge`
 *
 * The two sources never describe the same charge, so they simply add up.
 */
export function sumBookingPostedExtras(
  charges: BookingChargeRow[] = [],
  payments: BookingPaymentRow[] = []
): number {
  const fromCharges = charges
    .filter((charge) => charge.chargeType !== 'ROOM_RATE')
    .reduce((sum, charge) => sum + charge.amount * (charge.quantity || 1), 0)

  const fromManualPayments = payments
    .filter((payment) => MANUAL_CHARGE_PAYMENT_TYPES.has(payment.paymentType))
    .reduce((sum, payment) => sum + Math.max(0, payment.amount), 0)

  return fromCharges + fromManualPayments
}

export type BookingFolioRestaurantRow = {
  status?: string
  billingDisposition?: string | null
  companyLedgerBill?: { id: string } | null
  totalAmount: number
}

/**
 * Restaurant bills sitting on the room folio. They raise the stay due the moment
 * they are posted, so they belong in the stay total as well. Bills settled at the
 * counter or billed to a company ledger never reach the guest folio.
 */
export function sumBookingFolioRestaurant(
  orders: BookingFolioRestaurantRow[] = []
): number {
  return filterGuestFolioRestaurantOrders(orders).reduce(
    (sum, order) => sum + order.totalAmount,
    0
  )
}

/** Net amount collected on a booking (payments minus refunds). */
export function sumBookingNetPaid(payments: BookingPaymentRow[]): number {
  return payments.reduce((sum, p) => {
    if (p.paymentType === 'REFUND') return sum - Math.abs(p.amount)
    return sum + p.amount
  }, 0)
}

/** Guest checkout total paid — excludes restaurant counter payments (already settled at POS). */
export function sumCheckoutBookingPaid(payments: BookingPaymentRow[]): number {
  return payments.reduce((sum, p) => {
    if (p.paymentType === 'REFUND') return sum - Math.abs(p.amount)
    if (p.paymentType === 'RESTAURANT') return sum
    return sum + p.amount
  }, 0)
}

export function computeRefundFromInput(
  maxRefundable: number,
  mode: 'percent' | 'amount',
  percent: number,
  amount: number
): number {
  if (maxRefundable <= 0) return 0
  if (mode === 'percent') {
    const pct = Math.min(100, Math.max(0, percent))
    return Math.round((maxRefundable * pct) / 100 * 100) / 100
  }
  return Math.min(maxRefundable, Math.max(0, amount))
}
