import { computeOrderDue } from '@/lib/restaurant-order-dues'

export type OrderBillingState = 'PENDING' | 'HOTEL_BILL' | 'PAID_DIRECT'

type LedgerBillRef = {
  id: string
  settlementStage?: string | null
  dueAmount?: number | null
}

type BillingOrder = {
  billingDisposition?: string | null
  companyLedgerBill?: LedgerBillRef | null
  payments?: { amount: number; paymentType: string }[]
  totalAmount: number
}

function isLedgerBillFullySettled(bill?: LedgerBillRef | null): boolean {
  if (!bill) return false
  if (bill.settlementStage === 'PAID') return true
  return (bill.dueAmount ?? 0) <= 0.009
}

export function resolveOrderBillingState(order: BillingOrder): OrderBillingState {
  const { isSettled } = computeOrderDue(order.totalAmount, order.payments ?? [])
  if (isSettled || order.billingDisposition === 'PAID_DIRECT') {
    return 'PAID_DIRECT'
  }
  if (order.billingDisposition === 'HOTEL_BILL' || order.companyLedgerBill) {
    if (isLedgerBillFullySettled(order.companyLedgerBill)) {
      return 'PAID_DIRECT'
    }
    return 'HOTEL_BILL'
  }
  return 'PENDING'
}

export function canSendOrderToHotel(order: {
  orderType: string
  status: string
  billingDisposition?: string | null
  companyLedgerBill?: { id: string } | null
  payments?: { amount: number; paymentType: string }[]
  totalAmount: number
}): boolean {
  if (order.orderType !== 'ROOM_SERVICE') return false
  if (order.status !== 'DELIVERED') return false
  if (order.billingDisposition === 'HOTEL_BILL' || order.companyLedgerBill) return false
  if (resolveOrderBillingState(order) !== 'PENDING') return false
  const { dueAmount } = computeOrderDue(order.totalAmount, order.payments ?? [])
  return dueAmount > 0.009
}

export function canPayOrderDirectly(order: {
  status: string
  billingDisposition?: string | null
  companyLedgerBill?: { id: string } | null
  payments?: { amount: number; paymentType: string }[]
  totalAmount: number
}): boolean {
  if (order.status !== 'DELIVERED') return false
  if (resolveOrderBillingState(order) !== 'PENDING') return false
  const { dueAmount } = computeOrderDue(order.totalAmount, order.payments ?? [])
  return dueAmount > 0.009
}

export function formatOrderBillingState(state: OrderBillingState): string {
  switch (state) {
    case 'HOTEL_BILL':
      return 'Sent to hotel'
    case 'PAID_DIRECT':
      return 'Paid at restaurant'
    default:
      return 'Charge to room'
  }
}

export function formatOrderBillingDetail(order: BillingOrder): string {
  const state = resolveOrderBillingState(order)
  const { paidAmount, dueAmount } = computeOrderDue(order.totalAmount, order.payments ?? [])
  if (state === 'HOTEL_BILL') {
    if (paidAmount > 0.009 && dueAmount > 0.009) {
      return 'Partial paid — balance sent to hotel'
    }
    return formatOrderBillingState('HOTEL_BILL')
  }
  if (state === 'PAID_DIRECT') return formatOrderBillingState('PAID_DIRECT')
  if (paidAmount > 0.009 && dueAmount > 0.009) {
    return 'Partial paid — balance on room bill'
  }
  return formatOrderBillingState('PENDING')
}

export function hasPartialRestaurantPayment(order: BillingOrder): boolean {
  const { paidAmount, dueAmount } = computeOrderDue(order.totalAmount, order.payments ?? [])
  return paidAmount > 0.009 && dueAmount > 0.009
}

export type RestaurantBalanceDestination =
  | 'SENT_TO_HOTEL'
  | 'GUEST_ROOM_BILL'
  | 'RESTAURANT_DUE'

export function resolveRestaurantBalanceDisplay(order: {
  billingDisposition?: string | null
  companyLedgerBill?: { id: string } | null
  bookingId?: string | null
  orderType?: string
  payments?: { amount: number; paymentType: string }[]
  totalAmount: number
}): {
  dueAmount: number
  destination: RestaurantBalanceDestination | null
  label: string
  note: string | null
} {
  const { dueAmount } = computeOrderDue(order.totalAmount, order.payments ?? [])
  if (dueAmount <= 0.009) {
    return { dueAmount: 0, destination: null, label: '', note: null }
  }

  const billingState = resolveOrderBillingState(order)
  if (billingState === 'HOTEL_BILL') {
    return {
      dueAmount,
      destination: 'SENT_TO_HOTEL',
      label: 'Sent to hotel',
      note: 'Remaining balance sent to hotel billing',
    }
  }

  if (order.orderType === 'ROOM_SERVICE' && order.bookingId) {
    return {
      dueAmount,
      destination: 'GUEST_ROOM_BILL',
      label: 'Guest room bill',
      note: 'Remaining balance on guest room bill at checkout',
    }
  }

  return {
    dueAmount,
    destination: 'RESTAURANT_DUE',
    label: 'Balance due',
    note: 'Amount still due at restaurant',
  }
}

export function resolveSlipRemainderPreview(input: {
  remainderAmount: number
  roomGuestOrder: boolean
  postRemainderToGuestFolio: boolean
  sendRemainderToHotelLedger: boolean
}): {
  label: string
  note: string
  destination: RestaurantBalanceDestination
} | null {
  if (input.remainderAmount <= 0.009) return null

  if (input.sendRemainderToHotelLedger) {
    return {
      destination: 'SENT_TO_HOTEL',
      label: 'Sent to hotel',
      note: 'This balance will be sent to hotel billing when you collect',
    }
  }

  if (input.roomGuestOrder && input.postRemainderToGuestFolio) {
    return {
      destination: 'GUEST_ROOM_BILL',
      label: 'Guest room bill',
      note: 'This balance will be posted to the guest room bill when you collect',
    }
  }

  return {
    destination: 'RESTAURANT_DUE',
    label: 'Balance due',
    note: 'This balance remains due at the restaurant',
  }
}

/** Orders that still belong on the guest hotel folio at checkout. */
export function isGuestFolioRestaurantOrder(order: {
  status?: string
  billingDisposition?: string | null
  companyLedgerBill?: { id: string } | null
}): boolean {
  if (order.status === 'CANCELLED') return false
  if (order.billingDisposition === 'PAID_DIRECT') return false
  // CloudView ledger orders are billed to the company, not the guest folio.
  if (order.companyLedgerBill) return false
  return true
}

export function filterGuestFolioRestaurantOrders<
  T extends {
    status?: string
    billingDisposition?: string | null
    companyLedgerBill?: { id: string } | null
  },
>(orders: T[]): T[] {
  return orders.filter(isGuestFolioRestaurantOrder)
}

export function isRoomServiceGuestOrder(order: {
  orderType?: string
  bookingId?: string | null
  booking?: { id: string } | null
}): boolean {
  if (order.orderType !== 'ROOM_SERVICE') return false
  return !!(order.bookingId ?? order.booking?.id)
}
