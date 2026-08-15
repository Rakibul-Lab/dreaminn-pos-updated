import { db } from '@/lib/db'
import { stampCurrentBusinessDate } from '@/lib/business-date'
import { generateRestaurantOrderNumber } from '@/lib/restaurant-order-number'
import {
  parsePaymentMethod,
  type PaymentMethodValue,
} from '@/lib/payment-method'
import { applyBookingChargeToStoredDue } from '@/lib/booking-totals'
import { formatBookingRestaurantBillNotes } from '@/lib/booking-restaurant-bill-notes'
import {
  computeGuestFolioRestaurantBillTotals,
} from '@/lib/booking-restaurant-bill.shared'

export {
  computeGuestFolioRestaurantBillTotals,
  GUEST_FOLIO_RESTAURANT_VAT_PERCENT,
  isGuestFolioManualRestaurantBill,
  type GuestFolioRestaurantBillTotals,
} from '@/lib/booking-restaurant-bill.shared'

export type BookingRestaurantBillInput = {
  billNo: string
  paymentMethod: PaymentMethodValue
  amount: number
  discount?: number
  vatApplied?: boolean
  vatPercent?: number
  notes?: string
}

export async function listBookingRestaurantBills(bookingId: string) {
  return db.restaurantOrder.findMany({
    where: {
      bookingId,
      status: { not: 'CANCELLED' },
      companyLedgerBill: { is: null },
      billingDisposition: { not: 'PAID_DIRECT' },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      orderNumber: true,
      subtotal: true,
      discount: true,
      vatPercent: true,
      vatAmount: true,
      totalAmount: true,
      notes: true,
      billingDisposition: true,
      status: true,
      createdAt: true,
    },
  })
}

export async function createBookingRestaurantBill(
  bookingId: string,
  input: BookingRestaurantBillInput,
  createdBy: string
) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: { select: { name: true, phone: true } },
      room: { select: { id: true, roomNumber: true } },
    },
  })

  if (!booking) {
    throw new Error('Booking not found')
  }

  if (booking.status !== 'CHECKED_IN') {
    throw new Error('Restaurant bills can only be added to checked-in guests')
  }

  const billNo = input.billNo?.trim()
  if (!billNo) {
    throw new Error('Bill number is required')
  }

  const paymentMethod = parsePaymentMethod(input.paymentMethod, 'NONE')

  const inclusiveAmount = Math.max(0, Number(input.amount) || 0)
  if (inclusiveAmount <= 0) {
    throw new Error('Amount must be greater than zero')
  }

  const discount = Math.max(0, Number(input.discount) || 0)
  if (discount > inclusiveAmount) {
    throw new Error('Discount cannot exceed amount')
  }

  const { subtotal, vatPercent, vatAmount, totalAmount } = computeGuestFolioRestaurantBillTotals({
    inclusiveAmount,
    discount,
    vatApplied: input.vatApplied !== false,
  })
  const businessDate = await stampCurrentBusinessDate()

  const combinedNotes = formatBookingRestaurantBillNotes({
    billNo,
    paymentMethod,
    notes: input.notes,
  })

  const order = await db.$transaction(async (tx) => {
    const orderNumber = await generateRestaurantOrderNumber(tx)

    const newOrder = await tx.restaurantOrder.create({
      data: {
        orderNumber,
        orderType: 'ROOM_SERVICE',
        status: 'DELIVERED',
        billingDisposition: 'PENDING',
        businessDate,
        bookingId: booking.id,
        roomId: booking.roomId,
        customerName: booking.customer.name,
        customerPhone: booking.customer.phone,
        subtotal,
        discount,
        vatPercent,
        vatAmount,
        totalAmount,
        notes: combinedNotes,
        createdBy,
      },
      select: {
        id: true,
        orderNumber: true,
        subtotal: true,
        discount: true,
        vatPercent: true,
        vatAmount: true,
        totalAmount: true,
        notes: true,
        billingDisposition: true,
        status: true,
        createdAt: true,
      },
    })

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        dueAmount: applyBookingChargeToStoredDue(booking.dueAmount ?? 0, totalAmount),
      },
    })

    return newOrder
  })

  return {
    order,
    roomNumber: booking.room.roomNumber,
  }
}
