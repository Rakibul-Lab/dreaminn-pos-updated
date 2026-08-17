import { countHotelStayNights } from '@/lib/hotel-times'

export type BookingDiscountType = 'PERCENTAGE' | 'FIXED'

export function parseBookingDiscountType(value: unknown): BookingDiscountType {
  return value === 'FIXED' ? 'FIXED' : 'PERCENTAGE'
}

export type BookingStayNightsInput = {
  checkIn?: Date | string | null
  checkOut?: Date | string | null
  nights?: number | null
}

function normalizeNights(value: unknown): number {
  const rounded = Math.round(Number(value) || 0)
  return rounded > 0 ? rounded : 1
}

function toStayDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Nights a fixed discount repeats over. A fixed discount is a cut on the nightly
 * rate, so ৳1,000 off a 2-night stay takes ৳2,000 off the room charge.
 */
export function resolveDiscountNights(
  input?: BookingStayNightsInput | number | null
): number {
  if (typeof input === 'number') return normalizeNights(input)
  if (input?.nights != null) return normalizeNights(input.nights)
  const checkIn = toStayDate(input?.checkIn)
  const checkOut = toStayDate(input?.checkOut)
  if (!checkIn || !checkOut) return 1
  return normalizeNights(countHotelStayNights(checkIn, checkOut))
}

/**
 * Nights actually billed on the folio — room charge ÷ nightly rate, so a stay
 * shortened or extended at checkout discounts the nights truly charged.
 */
export function resolveBilledDiscountNights(
  roomCharges: number,
  nightlyRate: number,
  fallbackNights: number
): number {
  if (nightlyRate > 0 && roomCharges > 0) {
    return normalizeNights(roomCharges / nightlyRate)
  }
  return normalizeNights(fallbackNights)
}

/**
 * Hotel/booking discount is always computed on room charges only.
 * Do not pass damage, extras, late checkout, or restaurant into `roomChargeBase`.
 * A fixed discount is per night; a percentage already scales with the stay.
 */
export function computeHotelDiscountAmount(
  roomChargeBase: number,
  enabled: boolean,
  type: BookingDiscountType,
  value: number,
  nights: number = 1
): number {
  if (!enabled || value <= 0 || roomChargeBase <= 0) return 0
  if (type === 'FIXED') {
    const perNight = Math.max(0, value)
    return Math.min(roomChargeBase, perNight * normalizeNights(nights))
  }
  const pct = Math.min(100, Math.max(0, value))
  return (roomChargeBase * pct) / 100
}

/** Room after discount + extras/damage at full price (never discounted). */
export function taxableHotelAfterRoomDiscount(
  roomCharges: number,
  discountAmount: number,
  extraCharges: number
): number {
  return Math.max(0, roomCharges - Math.max(0, discountAmount)) + Math.max(0, extraCharges)
}

export type BookingDiscountInput = BookingStayNightsInput & {
  discountEnabled?: boolean | null
  discountType?: string | null
  discountValue?: number | null
}

export function resolveBookingDiscount(input: BookingDiscountInput) {
  const enabled = input.discountEnabled === true
  const type = parseBookingDiscountType(input.discountType)
  const value = enabled ? Math.max(0, Number(input.discountValue) || 0) : 0
  const nights = resolveDiscountNights(input)
  return { enabled, type, value, nights }
}

export function formatBookingListDiscount(booking: BookingDiscountInput & {
  discountAmount?: number | null
  totalRoomCharge: number
}): { amount: number; label: string } {
  const { enabled, type, value, nights } = resolveBookingDiscount(booking)
  const amount =
    booking.discountAmount != null && booking.discountAmount > 0
      ? booking.discountAmount
      : computeHotelDiscountAmount(booking.totalRoomCharge, enabled, type, value, nights)

  if (!enabled || amount <= 0) {
    return { amount: 0, label: '' }
  }

  const label = type === 'PERCENTAGE' && value > 0 ? `${value}%` : 'Fixed'
  return { amount, label }
}
