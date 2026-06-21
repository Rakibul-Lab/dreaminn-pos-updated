import { parseBookingDiscountType } from '@/lib/booking-discount'

export type CheckoutDiscountInput = {
  discountEnabled: boolean
  discountType: 'PERCENTAGE' | 'FIXED'
  discountValue: number
  /** True when discount was set at reservation — checkout cannot add/change it. */
  reservationDiscountLocked: boolean
}

type BookingDiscountFields = {
  discountEnabled?: boolean | null
  discountType?: string | null
  discountValue?: number | null
}

/** Use reservation discount when already applied; otherwise allow checkout discount toggle. */
export function resolveCheckoutDiscount(
  booking: BookingDiscountFields,
  checkoutOverride?: {
    enabled?: boolean
    type?: string | null
    value?: number
  }
): CheckoutDiscountInput {
  if (booking.discountEnabled === true) {
    return {
      discountEnabled: true,
      discountType: parseBookingDiscountType(booking.discountType),
      discountValue: Math.max(0, Number(booking.discountValue) || 0),
      reservationDiscountLocked: true,
    }
  }

  const enabled = checkoutOverride?.enabled === true
  return {
    discountEnabled: enabled,
    discountType: parseBookingDiscountType(checkoutOverride?.type),
    discountValue: enabled ? Math.max(0, Number(checkoutOverride?.value) || 0) : 0,
    reservationDiscountLocked: false,
  }
}
