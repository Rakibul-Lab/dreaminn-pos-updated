import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { canAccessHotel, requireAuth } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse } from '@/lib/api-utils';
import { formatConfirmationNumber } from '@/lib/confirmation-number';
import { resolveBookingRegistrationNumber } from '@/lib/booking-registration';
import { sumBookingNetPaid, computeBookingRoomDue, resolveBookingDisplayDue } from '@/lib/booking-totals';
import {
  formatPaymentMethod,
  formatPaymentCategoryLabel,
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

    if (payment.paymentType === 'RESTAURANT') {
      return errorResponse('Use the restaurant receipt for restaurant order payments', 400);
    }

    const booking = payment.booking;
    let stayTotal: number | null = null;
    let totalPaid: number | null = null;
    let balanceDue: number | null = null;
    let hasAccountSummary = false;

    // Only the slip that settles the stay at check-out carries the account summary.
    // Every other slip — an advance, a single folio charge, a refund, or a check-out row
    // raised against one named charge — covers a single amount, so the stay balance
    // belongs on the invoice rather than on the slip.
    const isCheckoutSettlementSlip =
      payment.paymentType === 'FINAL' && !payment.categoryLabel?.trim();

    if (booking && isCheckoutSettlementSlip) {
      hasAccountSummary = true;
      const roomTotals = computeBookingRoomDue(booking, booking.payments);
      const latestInvoice = booking.invoices[0] ?? null;
      stayTotal =
        latestInvoice && (booking.status === 'CHECKED_OUT' || latestInvoice.totalAmount > 0)
          ? latestInvoice.totalAmount
          : roomTotals.totalWithVat;
      totalPaid = sumBookingNetPaid(booking.payments);
      balanceDue = resolveBookingDisplayDue(booking, booking.payments, latestInvoice);
    }
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
      paymentTypeLabel: formatPaymentCategoryLabel(
        payment.paymentType,
        payment.categoryLabel
      ),
      reference: payment.reference,
      accountDetail: formatPaymentAccountDetail(payment.method, payment.accountLastFour),
      notes: payment.notes,
      paidAt: payment.createdAt,
      businessDate: payment.businessDate,
      receivedBy: payment.receiver?.name ?? null,
      guestName: booking?.customer?.name ?? 'General Payment',
      guestPhone: booking?.customer?.phone ?? null,
      roomNumber: booking?.room?.roomNumber ?? null,
      confirmationNumber: booking ? formatConfirmationNumber(booking) : '—',
      registrationNumber: booking ? resolveBookingRegistrationNumber(booking) : null,
      bookingStatus: booking?.status ?? null,
      checkIn: booking?.checkIn ?? null,
      checkOut: booking?.checkOut ?? null,
      hasAccountSummary,
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
