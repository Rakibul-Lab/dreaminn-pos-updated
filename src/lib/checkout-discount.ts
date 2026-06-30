import { parseBookingDiscountType } from '@/lib/booking-discount'

export type CheckoutDiscountInput = {
  discountEnabled: boolean
  discountType: 'PERCENTAGE' | 'FIXED'
  discountValue: number
}

export type BookingDiscountPrefill = {
  enabled: boolean
  type: 'PERCENTAGE' | 'FIXED'
  value: number
}

type BookingDiscountFields = {
  discountEnabled?: boolean | null
  discountType?: string | null
  discountValue?: number | null
}

/** Checkout discount: staff override wins; otherwise fall back to reservation booking discount. */
export function resolveCheckoutDiscount(
  booking: BookingDiscountFields,
  checkoutOverride?: {
    enabled?: boolean
    type?: string | null
    value?: number
  }
): CheckoutDiscountInput {
  if (checkoutOverride?.enabled === true) {
    return {
      discountEnabled: true,
      discountType: parseBookingDiscountType(checkoutOverride.type ?? booking.discountType),
      discountValue: Math.max(0, Number(checkoutOverride.value) || 0),
    }
  }

  if (checkoutOverride?.enabled === false) {
    return {
      discountEnabled: false,
      discountType: parseBookingDiscountType(booking.discountType),
      discountValue: 0,
    }
  }

  if (booking.discountEnabled === true) {
    return {
      discountEnabled: true,
      discountType: parseBookingDiscountType(booking.discountType),
      discountValue: Math.max(0, Number(booking.discountValue) || 0),
    }
  }

  return {
    discountEnabled: false,
    discountType: 'PERCENTAGE',
    discountValue: 0,
  }
}

export function bookingDiscountPrefill(booking: BookingDiscountFields): BookingDiscountPrefill {
  return {
    enabled: booking.discountEnabled === true,
    type: parseBookingDiscountType(booking.discountType),
    value: Math.max(0, Number(booking.discountValue) || 0),
  }
}
