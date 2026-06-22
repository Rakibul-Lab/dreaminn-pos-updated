/** Guest folio restaurant bills (rooms / reservations) — VAT-inclusive at 5%, no service charge. */
export const GUEST_FOLIO_RESTAURANT_VAT_PERCENT = 5

export type GuestFolioRestaurantBillTotals = {
  subtotal: number
  discount: number
  vatPercent: number
  vatAmount: number
  totalAmount: number
}

/** Amount entered is VAT-inclusive; VAT is backed out at 5% when enabled. */
export function computeGuestFolioRestaurantBillTotals(input: {
  inclusiveAmount: number
  discount?: number
  vatApplied?: boolean
}): GuestFolioRestaurantBillTotals {
  const discount = Math.max(0, Number(input.discount) || 0)
  const inclusiveAmount = Math.max(0, Number(input.inclusiveAmount) || 0)
  const grossInclusive = Math.max(0, inclusiveAmount - discount)
  const vatApplied = input.vatApplied !== false

  if (!vatApplied || grossInclusive <= 0) {
    return {
      subtotal: grossInclusive,
      discount,
      vatPercent: 0,
      vatAmount: 0,
      totalAmount: grossInclusive,
    }
  }

  const vatPercent = GUEST_FOLIO_RESTAURANT_VAT_PERCENT
  const vatAmount = Math.round((grossInclusive * vatPercent) / (100 + vatPercent))
  const subtotal = grossInclusive - vatAmount

  return {
    subtotal,
    discount,
    vatPercent,
    vatAmount,
    totalAmount: grossInclusive,
  }
}

export function isGuestFolioManualRestaurantBill(order: {
  notes?: string | null
  items?: unknown[] | null
}): boolean {
  if (order.items && order.items.length > 0) return false
  const firstLine = order.notes?.trim()?.split('\n')[0]?.trim() ?? ''
  return firstLine.startsWith('Bill No.')
}
