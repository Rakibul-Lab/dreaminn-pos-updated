import type { PaymentMethod, PrismaClient } from '@prisma/client'
import { computeOrderDue } from '@/lib/restaurant-order-dues'

export const CLOUDVIEW_RESTAURANT_SLUG = 'cloudview-restaurant'

type LedgerDb = Pick<
  PrismaClient,
  'companyLedger' | 'companyLedgerBill' | 'restaurantOrder' | 'payment' | 'booking'
>

export async function ensureCloudViewRestaurantLedger(db: LedgerDb) {
  const existing = await db.companyLedger.findUnique({
    where: { slug: CLOUDVIEW_RESTAURANT_SLUG },
  })
  if (existing) return existing

  return db.companyLedger.create({
    data: {
      name: 'CloudView Restaurant',
      slug: CLOUDVIEW_RESTAURANT_SLUG,
      isSystem: true,
      active: true,
      notes: 'System ledger: hotel owes CloudView for room service and hotel-billed restaurant orders.',
    },
  })
}

export async function postRestaurantOrderToCloudViewLedger(
  db: LedgerDb,
  orderId: string
): Promise<void> {
  const order = await db.restaurantOrder.findUnique({
    where: { id: orderId },
    include: {
      room: { select: { roomNumber: true } },
      booking: { include: { customer: { select: { name: true } } } },
      companyLedgerBill: true,
      payments: { select: { amount: true, paymentType: true } },
    },
  })

  if (!order || order.companyLedgerBill) return
  if (order.status !== 'DELIVERED') return
  if (order.orderType !== 'ROOM_SERVICE') return
  if (order.billingDisposition === 'PAID_DIRECT') {
    throw new Error('This order was paid at restaurant and cannot be billed to the hotel')
  }

  const { paidAmount, dueAmount } = computeOrderDue(order.totalAmount, order.payments)
  if (dueAmount <= 0.009) {
    throw new Error('No remaining balance to send to hotel')
  }

  const ledger = await ensureCloudViewRestaurantLedger(db)
  const guestName =
    order.customerName?.trim() ||
    order.booking?.customer?.name?.trim() ||
    'Room guest'
  const roomNumber = order.room?.roomNumber ?? null
  const ledgerAmount = dueAmount
  const ledgerNotes = [
    order.bookingId ? 'Hotel guest room service — billed to hotel' : null,
    paidAmount > 0.009
      ? `Restaurant collected ৳${Math.round(paidAmount).toLocaleString()}; hotel balance ৳${Math.round(ledgerAmount).toLocaleString()}`
      : null,
  ]
    .filter(Boolean)
    .join('. ')

  await db.companyLedgerBill.create({
    data: {
      companyLedgerId: ledger.id,
      billType: 'RESTAURANT_ORDER',
      settlementStage: 'OPEN',
      restaurantOrderId: order.id,
      bookingId: order.bookingId,
      guestName,
      roomNumber,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      totalAmount: ledgerAmount,
      paidAmount: 0,
      dueAmount: ledgerAmount,
      notes: ledgerNotes || null,
    },
  })

  await db.companyLedger.update({
    where: { id: ledger.id },
    data: {
      totalBilled: { increment: ledgerAmount },
      dueAmount: { increment: ledgerAmount },
    },
  })

  await db.restaurantOrder.update({
    where: { id: order.id },
    data: { billingDisposition: 'HOTEL_BILL' },
  })
}

export async function clearHotelRestaurantBill(
  db: LedgerDb,
  billId: string,
  clearedBy: string
): Promise<void> {
  const bill = await db.companyLedgerBill.findUnique({
    where: { id: billId },
    include: { companyLedger: true },
  })
  if (!bill) throw new Error('Bill not found')
  if (bill.billType !== 'RESTAURANT_ORDER') {
    throw new Error('Only restaurant order bills can be cleared by hotel')
  }
  if (bill.settlementStage !== 'OPEN') {
    throw new Error('This bill is already cleared or paid')
  }
  if (bill.dueAmount <= 0) {
    throw new Error('No balance due on this bill')
  }

  await db.companyLedgerBill.update({
    where: { id: bill.id },
    data: {
      settlementStage: 'HOTEL_CLEARED',
      hotelClearedAt: new Date(),
      hotelClearedBy: clearedBy,
    },
  })
}

export async function clearAllOpenHotelRestaurantBills(
  db: LedgerDb,
  companyLedgerId: string,
  clearedBy: string
): Promise<number> {
  const openBills = await db.companyLedgerBill.findMany({
    where: {
      companyLedgerId,
      billType: 'RESTAURANT_ORDER',
      settlementStage: 'OPEN',
      dueAmount: { gt: 0 },
    },
    select: { id: true },
  })

  if (openBills.length === 0) return 0

  await db.companyLedgerBill.updateMany({
    where: { id: { in: openBills.map((b) => b.id) } },
    data: {
      settlementStage: 'HOTEL_CLEARED',
      hotelClearedAt: new Date(),
      hotelClearedBy: clearedBy,
    },
  })

  return openBills.length
}

export type RecordRestaurantLedgerPaymentInput = {
  billId: string
  amount: number
  method: PaymentMethod
  receivedBy: string
  reference?: string | null
  accountLastFour?: string | null
  notes?: string | null
}

export async function recordRestaurantLedgerBillPayment(
  db: LedgerDb,
  input: RecordRestaurantLedgerPaymentInput
): Promise<{ paymentId: string; billDueAmount: number }> {
  const amount = Math.max(0, input.amount)
  if (amount <= 0) throw new Error('Payment amount must be greater than 0')

  const bill = await db.companyLedgerBill.findUnique({
    where: { id: input.billId },
    include: {
      restaurantOrder: {
        include: { payments: { select: { amount: true, paymentType: true } } },
      },
    },
  })
  if (!bill) throw new Error('Bill not found')
  if (bill.billType !== 'RESTAURANT_ORDER') {
    throw new Error('This payment route is for restaurant ledger bills only')
  }
  if (bill.settlementStage !== 'HOTEL_CLEARED') {
    throw new Error('Hotel must clear this due before recording payment')
  }
  if (bill.dueAmount <= 0) throw new Error('This bill has no balance due')
  if (amount > bill.dueAmount + 0.01) {
    throw new Error(`Payment cannot exceed due amount (৳${bill.dueAmount.toFixed(2)})`)
  }

  const orderId = bill.restaurantOrderId
  if (!orderId) throw new Error('Restaurant order not linked to this bill')

  const payment = await db.payment.create({
    data: {
      amount,
      method: input.method,
      paymentType: 'RESTAURANT',
      orderId,
      bookingId: bill.bookingId,
      reference: input.reference?.trim() || null,
      accountLastFour: input.accountLastFour?.trim() || null,
      notes: input.notes?.trim() || null,
      settlementSource: 'HOTEL_DUE',
      receivedBy: input.receivedBy,
    },
  })

  const newPaid = bill.paidAmount + amount
  const newDue = Math.max(0, bill.dueAmount - amount)
  const fullyPaid = newDue <= 0.009

  await db.companyLedgerBill.update({
    where: { id: bill.id },
    data: {
      paidAmount: newPaid,
      dueAmount: newDue,
      settlementStage: fullyPaid ? 'PAID' : 'HOTEL_CLEARED',
    },
  })

  await db.companyLedger.update({
    where: { id: bill.companyLedgerId },
    data: {
      totalPaid: { increment: amount },
      dueAmount: { decrement: amount },
    },
  })

  if (fullyPaid && bill.restaurantOrder) {
    const orderDue = computeOrderDue(
      bill.restaurantOrder.totalAmount,
      [
        ...bill.restaurantOrder.payments,
        { amount, paymentType: 'RESTAURANT' },
      ]
    )
    if (orderDue.dueAmount <= 0.009) {
      await db.restaurantOrder.update({
        where: { id: orderId },
        data: { billingDisposition: 'PAID_DIRECT' },
      })
    }
  }

  return { paymentId: payment.id, billDueAmount: newDue }
}

export function formatSettlementStage(stage: string): string {
  switch (stage) {
    case 'OPEN':
      return 'Awaiting hotel'
    case 'HOTEL_CLEARED':
      return 'Hotel cleared — record payment'
    case 'PAID':
      return 'Paid'
    default:
      return stage
  }
}
