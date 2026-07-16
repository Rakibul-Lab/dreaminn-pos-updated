export type BookingDiscountType = 'PERCENTAGE' | 'FIXED'

export function parseBookingDiscountType(value: unknown): BookingDiscountType {
  return value === 'FIXED' ? 'FIXED' : 'PERCENTAGE'
}

/**
 * Hotel/booking discount is always computed on room charges only.
 * Do not pass damage, extras, late checkout, or restaurant into `roomChargeBase`.
 */
export function computeHotelDiscountAmount(
  roomChargeBase: number,
  enabled: boolean,
  type: BookingDiscountType,
  value: number
): number {
  if (!enabled || value <= 0 || roomChargeBase <= 0) return 0
  if (type === 'FIXED') {
    return Math.min(roomChargeBase, Math.max(0, value))
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

export type BookingDiscountInput = {
  discountEnabled?: boolean | null
  discountType?: string | null
  discountValue?: number | null
}

export function resolveBookingDiscount(input: BookingDiscountInput) {
  const enabled = input.discountEnabled === true
  const type = parseBookingDiscountType(input.discountType)
  const value = enabled ? Math.max(0, Number(input.discountValue) || 0) : 0
  return { enabled, type, value }
}

export function formatBookingListDiscount(booking: BookingDiscountInput & {
  discountAmount?: number | null
  totalRoomCharge: number
}): { amount: number; label: string } {
  const { enabled, type, value } = resolveBookingDiscount(booking)
  const amount =
    booking.discountAmount != null && booking.discountAmount > 0
      ? booking.discountAmount
      : computeHotelDiscountAmount(booking.totalRoomCharge, enabled, type, value)

  if (!enabled || amount <= 0) {
    return { amount: 0, label: '' }
  }

  const label = type === 'PERCENTAGE' && value > 0 ? `${value}%` : 'Fixed'
  return { amount, label }
}
