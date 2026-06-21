import { db } from '@/lib/db'
import { getRestaurantVatPercent } from '@/lib/app-settings'
import { stampCurrentBusinessDate } from '@/lib/business-date'
import { generateRestaurantOrderNumber } from '@/lib/restaurant-order-number'
import {
  parsePaymentMethod,
  type PaymentMethodValue,
} from '@/lib/payment-method'
import { formatBookingRestaurantBillNotes } from '@/lib/booking-restaurant-bill-notes'

export type BookingRestaurantBillInput = {
  billNo: string
  paymentMethod: PaymentMethodValue
  amount: number
  discount?: number
  vatPercent?: number
  notes?: string
}

export async function listBookingRestaurantBills(bookingId: string) {
  return db.restaurantOrder.findMany({
    where: {
      bookingId,
      status: { not: 'CANCELLED' },
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

  const paymentMethod = parsePaymentMethod(input.paymentMethod, 'CASH')

  const subtotal = Math.max(0, Number(input.amount) || 0)
  if (subtotal <= 0) {
    throw new Error('Amount must be greater than zero')
  }

  const discount = Math.max(0, Number(input.discount) || 0)
  if (discount > subtotal) {
    throw new Error('Discount cannot exceed amount')
  }

  const defaultVat = await getRestaurantVatPercent()
  const vatRate =
    input.vatPercent !== undefined && input.vatPercent !== null
      ? Math.max(0, Number(input.vatPercent) || 0)
      : defaultVat

  const taxable = Math.max(0, subtotal - discount)
  const vatAmount = (taxable * vatRate) / 100
  const totalAmount = taxable + vatAmount
  const businessDate = await stampCurrentBusinessDate()

  const combinedNotes = formatBookingRestaurantBillNotes({
    billNo,
    paymentMethod,
    notes: input.notes,
  })

  const order = await db.$transaction(async (tx) => {
    const orderNumber = await generateRestaurantOrderNumber(tx)

    return tx.restaurantOrder.create({
      data: {
        orderNumber,
        orderType: 'ROOM_SERVICE',
        status: 'DELIVERED',
        billingDisposition: 'HOTEL_BILL',
        businessDate,
        bookingId: booking.id,
        roomId: booking.roomId,
        customerName: booking.customer.name,
        customerPhone: booking.customer.phone,
        subtotal,
        discount,
        vatPercent: vatRate,
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
  })

  return {
    order,
    roomNumber: booking.room.roomNumber,
  }
}
