import { computeHotelDiscountAmount, parseBookingDiscountType, taxableHotelAfterRoomDiscount } from '@/lib/booking-discount'
import {
  bookingDiscountInput,
  bookingVatOptions,
  computeRoomBookingTotals,
  sumCheckoutBookingPaid,
} from '@/lib/booking-totals'
import {
  computeAdjustedRoomCharge,
  countActualStayNights,
  countBookedNights,
  type StayAdjustmentMode,
} from '@/lib/booking-stay'
import { filterGuestFolioRestaurantOrders } from '@/lib/restaurant-order-billing'
import { computeOrderFolioBalance } from '@/lib/restaurant-order-dues'
import { parseBookingRestaurantBillNotes } from '@/lib/booking-restaurant-bill-notes'

type BookingCharge = {
  chargeType: string
  description?: string | null
  amount: number
  quantity: number
}

export type PostedExtraChargeLine = {
  label: string
  amount: number
}

const POSTED_CHARGE_TYPE_LABELS: Record<string, string> = {
  MINIBAR: 'Beverage / minibar',
  LAUNDRY: 'Laundry',
  EXTRA_SERVICE: 'Extra Charges',
  EARLY_CHECKOUT: 'Early checkout fee',
  OTHER: 'Others',
}

function postedChargeLabel(charge: BookingCharge): string {
  const description = charge.description?.trim()
  if (description) return description
  return POSTED_CHARGE_TYPE_LABELS[charge.chargeType] ?? charge.chargeType.replace(/_/g, ' ')
}

type RestaurantOrderRow = {
  subtotal: number
  discount: number
  vatAmount: number
  totalAmount: number
  billingDisposition?: string | null
  status?: string
  payments?: { amount: number; paymentType: string }[]
}

export type CheckoutSettlementParams = {
  booking: {
    checkIn: Date
    checkOut: Date
    actualCheckIn: Date | null
    totalRoomCharge: number
    vatApplied?: boolean | null
    vatPercent?: number | null
    charges: BookingCharge[]
  }
  nightlyRate: number
  restaurantOrders: RestaurantOrderRow[]
  lateCheckoutCharge: number
  payments: { amount: number; paymentType: string }[]
  discountEnabled?: boolean
  discountType?: string | null
  discountValue?: number
  includeExtraCharges?: boolean
  /** Pending damage charge for preview (not yet saved) or explicit amount to include. */
  damageChargeAmount?: number
  /** Manual late checkout amount at checkout (not from settings). */
  lateCheckoutAmount?: number | null
  /** Override room charge total at checkout (BDT). */
  roomChargeOverride?: number | null
  asOf?: Date
}

export type CheckoutSettlementResult = {
  bookedNights: number
  actualStayNights: number
  chargeableNights: number
  stayAdjustmentMode: StayAdjustmentMode | null
  nightlyRate: number
  bookedRoomCharge: number
  roomCharges: number
  stayAdjusted: boolean
  includeExtraCharges: boolean
  /** Minibar, laundry, and other posted folio charges (always on invoice). */
  postedExtraCharges: number
  /** Same posted charges itemised by their folio description, for checkout display. */
  postedExtraChargeLines: PostedExtraChargeLine[]
  extraChargesStored: number
  lateCheckoutCharge: number
  extraChargesIfIncluded: number
  extraCharges: number
  damageCharge: number
  foodCharges: number
  subtotal: number
  discount: number
  vatApplied: boolean
  vatPercent: number
  vatAmount: number
  restaurantVat: number
  hotelVat: number
  totalAmount: number
  totalPaid: number
  dueBeforeSettlement: number
  creditAmount: number
}

function sumDamageFromCharges(charges: BookingCharge[]): number {
  return charges
    .filter((c) => c.chargeType === 'DAMAGE')
    .reduce((sum, c) => sum + c.amount * c.quantity, 0)
}

function sumNonRoomCharges(charges: BookingCharge[], excludeLate = false): number {
  return charges
    .filter(
      (c) =>
        c.chargeType !== 'ROOM_RATE' &&
        c.chargeType !== 'DAMAGE' &&
        (!excludeLate || c.chargeType !== 'LATE_CHECKOUT')
    )
    .reduce((sum, c) => sum + c.amount * c.quantity, 0)
}

function groupPostedExtraCharges(charges: BookingCharge[]): PostedExtraChargeLine[] {
  const byLabel = new Map<string, number>()
  for (const charge of charges) {
    if (
      charge.chargeType === 'ROOM_RATE' ||
      charge.chargeType === 'DAMAGE' ||
      charge.chargeType === 'LATE_CHECKOUT'
    ) {
      continue
    }
    const label = postedChargeLabel(charge)
    byLabel.set(label, (byLabel.get(label) ?? 0) + charge.amount * charge.quantity)
  }
  return Array.from(byLabel, ([label, amount]) => ({ label, amount })).filter(
    (line) => Math.abs(line.amount) > 0.005
  )
}

export type SentToRoomCharge = BookingCharge & { recordedBy?: string | null }

/**
 * Folio charges posted through Payments → Send to room, grouped by the label the
 * cashier picked. Charges posted by other flows (minibar, housekeeping laundry)
 * carry no recorder and stay out of this list.
 */
export function groupSentToRoomCharges(charges: SentToRoomCharge[]): PostedExtraChargeLine[] {
  return groupPostedExtraCharges(charges.filter((charge) => !!charge.recordedBy)).filter(
    (line) => line.amount > 0.005
  )
}

export type FolioRestaurantOrderRow = RestaurantOrderRow & {
  orderNumber?: string | null
  notes?: string | null
  companyLedgerBill?: { id: string } | null
}

/**
 * Restaurant bills still owed on the room folio, one line per bill so each one can
 * be settled — and slipped — separately at check-out.
 */
export function groupFolioRestaurantCharges(
  orders: FolioRestaurantOrderRow[]
): PostedExtraChargeLine[] {
  const byLabel = new Map<string, number>()

  for (const order of filterGuestFolioRestaurantOrders(orders)) {
    const { folioDue } = computeOrderFolioBalance(order)
    if (folioDue <= 0.005) continue

    const billNo = parseBookingRestaurantBillNotes(order.notes ?? null).billNo
    const label =
      billNo !== '—'
        ? `Restaurant · Bill ${billNo}`
        : order.orderNumber
          ? `Restaurant · Order ${order.orderNumber}`
          : 'Restaurant'

    byLabel.set(label, (byLabel.get(label) ?? 0) + folioDue)
  }

  return Array.from(byLabel, ([label, amount]) => ({ label, amount }))
}

function sumLateFromCharges(charges: BookingCharge[]): number {
  return charges
    .filter((c) => c.chargeType === 'LATE_CHECKOUT')
    .reduce((sum, c) => sum + c.amount * c.quantity, 0)
}

export function computeCheckoutSettlement(
  params: CheckoutSettlementParams
): CheckoutSettlementResult {
  const asOf = params.asOf ?? new Date()
  const { booking, nightlyRate, restaurantOrders, lateCheckoutCharge, payments } = params
  const includeExtraCharges = params.includeExtraCharges !== false

  const bookedNights = countBookedNights(booking.checkIn, booking.checkOut)
  const bookedRoomCharge = computeAdjustedRoomCharge(nightlyRate, bookedNights)

  const actualCheckIn = booking.actualCheckIn ?? booking.checkIn
  const actualStayNights = countActualStayNights(actualCheckIn, asOf)

  const individualRoomCharges = booking.charges
    .filter((c) => c.chargeType === 'ROOM_RATE')
    .reduce((sum, c) => sum + c.amount * c.quantity, 0)

  const roomCharges =
    params.roomChargeOverride != null && params.roomChargeOverride >= 0
      ? params.roomChargeOverride
      : individualRoomCharges > 0
        ? individualRoomCharges
        : booking.totalRoomCharge

  const chargeableNights =
    nightlyRate > 0 && roomCharges > 0
      ? Math.max(1, Math.round(roomCharges / nightlyRate))
      : bookedNights

  const stayAdjusted = chargeableNights !== bookedNights
  const stayAdjustmentMode: StayAdjustmentMode | null = stayAdjusted
    ? chargeableNights < bookedNights
      ? 'shrink'
      : 'extend'
    : null

  const lateInDb = sumLateFromCharges(booking.charges)
  const damageInDb = sumDamageFromCharges(booking.charges)
  const postedExtraCharges = sumNonRoomCharges(booking.charges, true)
  const postedExtraChargeLines = groupPostedExtraCharges(booking.charges)
  const manualLate =
    params.lateCheckoutAmount != null ? Math.max(0, params.lateCheckoutAmount) : null
  const lateWouldBe = lateInDb > 0 ? lateInDb : includeExtraCharges ? (manualLate ?? 0) : 0
  const pendingDamage = Math.max(0, params.damageChargeAmount ?? 0)
  const damageCharge = damageInDb > 0 ? damageInDb : pendingDamage
  const extraChargesIfIncluded = postedExtraCharges + lateWouldBe
  const extraCharges = postedExtraCharges + (includeExtraCharges ? lateWouldBe : 0) + damageCharge

  const folioRestaurantOrders = filterGuestFolioRestaurantOrders(restaurantOrders)

  let restaurantNet = 0
  let restaurantVat = 0
  let restaurantTotal = 0
  for (const order of folioRestaurantOrders) {
    const folio = computeOrderFolioBalance(order)
    restaurantNet += folio.folioNet
    restaurantVat += folio.folioVat
    restaurantTotal += folio.folioDue
  }
  const foodCharges = restaurantNet

  const hotelBase = roomCharges + extraCharges
  const subtotal = hotelBase + restaurantNet
  const vatOpts = bookingVatOptions(booking)
  const vatApplied = vatOpts.vatApplied !== false
  const hotelVatRate = vatApplied ? Math.max(0, vatOpts.vatPercent ?? 0) : 0
  // Discount applies to room charges only — never damage, late checkout, or other extras.
  const discount = computeHotelDiscountAmount(
    roomCharges,
    params.discountEnabled === true,
    parseBookingDiscountType(params.discountType),
    Number(params.discountValue) || 0,
    chargeableNights
  )
  const taxableHotel = taxableHotelAfterRoomDiscount(roomCharges, discount, extraCharges)
  const hotelVat =
    hotelVatRate > 0 ? (taxableHotel * hotelVatRate) / 100 : 0
  const vatAmount = hotelVat + restaurantVat
  const totalAmount = taxableHotel + hotelVat + restaurantTotal

  const totalPaid = sumCheckoutBookingPaid(payments)
  const dueBeforeSettlement = totalAmount - totalPaid
  const creditAmount = dueBeforeSettlement < 0 ? Math.abs(dueBeforeSettlement) : 0

  return {
    bookedNights,
    actualStayNights,
    chargeableNights,
    stayAdjustmentMode,
    nightlyRate,
    bookedRoomCharge,
    roomCharges,
    stayAdjusted,
    includeExtraCharges,
    postedExtraCharges,
    postedExtraChargeLines,
    extraChargesStored: postedExtraCharges,
    lateCheckoutCharge: lateWouldBe,
    extraChargesIfIncluded,
    extraCharges,
    damageCharge,
    foodCharges,
    subtotal,
    discount,
    vatApplied,
    vatPercent: hotelVatRate,
    vatAmount,
    restaurantVat,
    hotelVat,
    totalAmount,
    totalPaid,
    dueBeforeSettlement: Math.max(0, dueBeforeSettlement),
    creditAmount,
  }
}

/** Room VAT-inclusive due after stay adjustment (for updating booking.dueAmount). */
export function bookingDueAfterPayments(
  totalRoomCharge: number,
  totalPaid: number,
  booking: {
    checkIn?: Date | string | null
    checkOut?: Date | string | null
    nights?: number | null
    vatApplied?: boolean | null
    vatPercent?: number | null
    discountEnabled?: boolean | null
    discountType?: string | null
    discountValue?: number | null
  }
): number {
  return computeRoomBookingTotals(
    totalRoomCharge,
    totalPaid,
    bookingVatOptions(booking),
    bookingDiscountInput(booking)
  ).dueAmount
}
