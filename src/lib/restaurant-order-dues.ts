export type OrderPaymentRow = { amount: number; paymentType: string }

/** Net amount paid on a restaurant order (payments minus refunds). */
export function sumOrderNetPaid(payments: OrderPaymentRow[]): number {
  return payments.reduce((sum, p) => {
    if (p.paymentType === 'REFUND') return sum - Math.abs(p.amount)
    return sum + p.amount
  }, 0)
}

export function computeOrderDue(totalAmount: number, payments: OrderPaymentRow[]): {
  paidAmount: number
  dueAmount: number
  isSettled: boolean
} {
  const paidAmount = sumOrderNetPaid(payments)
  const dueAmount = Math.max(0, totalAmount - paidAmount)
  return {
    paidAmount,
    dueAmount,
    isSettled: dueAmount <= 0.009,
  }
}

/** Remaining guest-folio balance after restaurant counter payments (pro-rated net/VAT). */
export function computeOrderFolioBalance(order: {
  subtotal: number
  discount: number
  vatAmount: number
  totalAmount: number
  payments?: OrderPaymentRow[]
}): {
  paidAmount: number
  folioDue: number
  folioNet: number
  folioVat: number
} {
  const { paidAmount, dueAmount: folioDue } = computeOrderDue(
    order.totalAmount,
    order.payments ?? []
  )
  if (folioDue <= 0.009 || order.totalAmount <= 0) {
    return { paidAmount, folioDue: 0, folioNet: 0, folioVat: 0 }
  }
  const ratio = folioDue / order.totalAmount
  const baseNet = Math.max(0, order.subtotal - order.discount)
  return {
    paidAmount,
    folioDue,
    folioNet: baseNet * ratio,
    folioVat: order.vatAmount * ratio,
  }
}

/** Room-service on a guest folio — hotel collects from guest, then pays restaurant. */
export function isHotelFolioRestaurantOrder(order: {
  orderType: string
  bookingId?: string | null
}): boolean {
  return order.orderType === 'ROOM_SERVICE' && !!order.bookingId
}

export function formatGuestFolioStatus(bookingStatus?: string | null): string {
  if (bookingStatus === 'CHECKED_OUT') return 'Guest paid at hotel checkout'
  if (bookingStatus === 'CHECKED_IN') return 'On guest folio — awaiting checkout'
  if (bookingStatus === 'RESERVED') return 'Reserved — not checked in'
  return 'Guest folio'
}

export function formatOrderTypeLabel(orderType: string): string {
  switch (orderType) {
    case 'DINE_IN':
      return 'Dine-in'
    case 'TAKEAWAY':
      return 'Takeaway'
    case 'ROOM_SERVICE':
      return 'Room service'
    default:
      return orderType.replace(/_/g, ' ')
  }
}
