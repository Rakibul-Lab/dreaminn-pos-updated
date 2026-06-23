import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { canAccessHotel, requireAuth } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse } from '@/lib/api-utils';
import { formatConfirmationNumber } from '@/lib/confirmation-number';
import { resolveBookingRegistrationNumber } from '@/lib/booking-registration';
import { sumBookingNetPaid, computeBookingRoomDue, resolveBookingDisplayDue } from '@/lib/booking-totals';
import {
  formatPaymentMethod,
  formatPaymentTypeLabel,
  formatPaymentAccountDetail,
} from '@/lib/payment-method';
import { formatPaymentSlipNumber } from '@/lib/booking-payment-slip';
import { HOTEL_LOCATION, HOTEL_NAME } from '@/lib/reservation-terms';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    if (!canAccessHotel(authResult.role)) {
      return errorResponse('You do not have permission to view payment slips', 403);
    }

    const { id } = await params;

    const payment = await db.payment.findUnique({
      where: { id },
      include: {
        receiver: { select: { name: true } },
        booking: {
          select: {
            id: true,
            confirmationNumber: true,
            registrationNumber: true,
            status: true,
            checkIn: true,
            checkOut: true,
            totalRoomCharge: true,
            dueAmount: true,
            vatApplied: true,
            vatPercent: true,
            discountEnabled: true,
            discountType: true,
            discountValue: true,
            customer: { select: { name: true, phone: true } },
            room: { select: { roomNumber: true } },
            payments: { select: { amount: true, paymentType: true } },
            invoices: {
              where: { status: { not: 'CANCELLED' } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { totalAmount: true, dueAmount: true, status: true },
            },
          },
        },
        invoice: {
          select: { invoiceNumber: true },
        },
      },
    });

    if (!payment) return notFoundResponse('Payment');

    if (!payment.bookingId || !payment.booking) {
      return errorResponse('Payment slip is only available for hotel booking payments', 400);
    }

    if (payment.paymentType === 'RESTAURANT') {
      return errorResponse('Use the restaurant receipt for restaurant order payments', 400);
    }

    const booking = payment.booking;
    const roomTotals = computeBookingRoomDue(booking, booking.payments);
    const latestInvoice = booking.invoices[0] ?? null;
    const stayTotal =
      booking.status === 'CHECKED_OUT' && latestInvoice
        ? latestInvoice.totalAmount
        : roomTotals.totalWithVat;
    const totalPaid = sumBookingNetPaid(booking.payments);
    const balanceDue = resolveBookingDisplayDue(booking, booking.payments, latestInvoice);
    const isRefund = payment.paymentType === 'REFUND';

    return successResponse({
      hotelName: HOTEL_NAME,
      hotelLocation: HOTEL_LOCATION,
      slipNumber: formatPaymentSlipNumber(payment),
      paymentId: payment.id,
      amount: payment.amount,
      isRefund,
      method: payment.method,
      methodLabel: formatPaymentMethod(payment.method),
      paymentType: payment.paymentType,
      paymentTypeLabel: formatPaymentTypeLabel(payment.paymentType),
      reference: payment.reference,
      accountDetail: formatPaymentAccountDetail(payment.method, payment.accountLastFour),
      notes: payment.notes,
      paidAt: payment.createdAt,
      businessDate: payment.businessDate,
      receivedBy: payment.receiver?.name ?? null,
      guestName: booking.customer.name,
      guestPhone: booking.customer.phone ?? null,
      roomNumber: booking.room?.roomNumber ?? null,
      confirmationNumber: formatConfirmationNumber(booking),
      registrationNumber: resolveBookingRegistrationNumber(booking),
      bookingStatus: booking.status,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      stayTotal,
      totalPaid,
      balanceDue,
      invoiceNumber: payment.invoice?.invoiceNumber ?? null,
    });
  } catch (error) {
    console.error('Booking payment receipt error:', error);
    return errorResponse('Failed to load payment slip', 500);
  }
}
