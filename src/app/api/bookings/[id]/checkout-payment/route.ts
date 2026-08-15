import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils'
import { RoleType } from '@prisma/client'
import {
  isValidPaymentAccountLastFour,
  parsePaymentMethod,
  paymentRequiresLastFour,
  paymentRequiresReference,
} from '@/lib/payment-method'
import { groupFolioRestaurantCharges, groupSentToRoomCharges } from '@/lib/checkout-settlement'
import { recordFolioSettlementPayments, subtractSettledCharges } from '@/lib/folio-settlement'
import { resolveActiveBookingInvoiceId, syncInvoicePaymentTotals } from '@/lib/invoice-payments'
import { applyBookingPaymentToStoredDue } from '@/lib/booking-totals'
import { stampCurrentBusinessDate } from '@/lib/business-date'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Money taken on the check-out screen. It is banked straight away rather than held
 * until the stay is settled, so the guest's due drops and the payment shows up on the
 * payments list even when it only covers part of the bill.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    )
    if (authResult instanceof Response) return authResult

    const { id } = await context.params
    const body = await request.json()

    const amount = Math.round(Math.max(0, Number(body?.amount || 0)) * 100) / 100
    if (amount <= 0) {
      return errorResponse('Enter a payment amount greater than zero')
    }

    const method = parsePaymentMethod(body?.method, 'CASH')
    if (method === 'NONE') {
      return errorResponse('Select a payment method')
    }

    const reference = body?.reference ? String(body.reference).trim() : null
    const accountLastFour = body?.accountLastFour ? String(body.accountLastFour).trim() : null
    const notes = body?.notes ? String(body.notes).trim() : null

    if (paymentRequiresReference(method) && !reference) {
      return errorResponse('Payment reference is required for this payment method')
    }
    if (
      paymentRequiresLastFour(method) &&
      (!accountLastFour || !isValidPaymentAccountLastFour(accountLastFour))
    ) {
      return errorResponse('Last 4 digits are required for card / bKash / Nagad / Upay')
    }

    const booking = await db.booking.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        dueAmount: true,
        charges: true,
        room: { select: { roomNumber: true } },
      },
    })
    if (!booking) return notFoundResponse('Booking')
    if (booking.status !== 'CHECKED_IN') {
      return errorResponse('Only a checked-in stay can take a payment from the check-out screen')
    }

    const [restaurantOrders, existingPayments] = await Promise.all([
      db.restaurantOrder.findMany({
        where: { bookingId: id, status: { not: 'CANCELLED' } },
        select: {
          orderNumber: true,
          notes: true,
          status: true,
          billingDisposition: true,
          subtotal: true,
          discount: true,
          vatAmount: true,
          totalAmount: true,
          companyLedgerBill: { select: { id: true } },
          payments: { select: { amount: true, paymentType: true } },
        },
      }),
      db.payment.findMany({
        where: { bookingId: id },
        select: { amount: true, categoryLabel: true },
      }),
    ])

    const pendingCharges = subtractSettledCharges(
      [...groupSentToRoomCharges(booking.charges), ...groupFolioRestaurantCharges(restaurantOrders)],
      existingPayments
    )

    const businessDate = await stampCurrentBusinessDate()
    const invoiceId = await resolveActiveBookingInvoiceId(db, id)

    await recordFolioSettlementPayments(db, {
      bookingId: id,
      receivedBy: authResult.id,
      businessDate,
      invoiceId,
      pendingCharges,
      rows: [{ amount, method, reference, accountLastFour, notes }],
      defaultNotes: 'Payment at check-out',
    })

    let updatedDueAmount = applyBookingPaymentToStoredDue(booking.dueAmount ?? 0, amount)
    await db.booking.update({ where: { id }, data: { dueAmount: updatedDueAmount } })

    if (invoiceId) {
      const synced = await syncInvoicePaymentTotals(db, invoiceId)
      if (synced) {
        updatedDueAmount = synced.dueAmount
        await db.booking.update({ where: { id }, data: { dueAmount: synced.dueAmount } })
      }
    }

    await logActivity(
      authResult.id,
      'PAYMENT_CREATED',
      'billing',
      JSON.stringify({ bookingId: id, amount, method, source: 'checkout-screen', invoiceId })
    )

    return successResponse(
      { amount, method, updatedDueAmount },
      `Payment of ৳${amount.toFixed(2)} recorded for room ${booking.room.roomNumber}`,
      201
    )
  } catch (error) {
    console.error('Check-out screen payment error:', error)
    return errorResponse('Failed to record payment', 500)
  }
}
