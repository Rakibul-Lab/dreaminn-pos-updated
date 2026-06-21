import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import {
  computeBookingRoomDue,
  computeRefundFromInput,
  sumBookingNetPaid,
} from '@/lib/booking-totals';
import { parsePaymentMethod } from '@/lib/payment-method';
import { countBookedNights } from '@/lib/booking-stay';
import { RoleType } from '@prisma/client';

async function loadBookingForCancel(id: string) {
  return db.booking.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      room: { select: { id: true, roomNumber: true, status: true } },
      payments: { select: { amount: true, paymentType: true } },
    },
  });
}

/** Preview refundable amount before cancelling. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(_request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;
    const booking = await loadBookingForCancel(id);
    if (!booking) return notFoundResponse('Booking');

    if (booking.status === 'CANCELLED') {
      return errorResponse('This reservation is already cancelled');
    }
    if (booking.status === 'CHECKED_OUT') {
      return errorResponse('Checked-out reservations cannot be cancelled here');
    }

    const maxRefundable = sumBookingNetPaid(booking.payments);
    const totals = computeBookingRoomDue(booking, booking.payments);

    const bookedNights = countBookedNights(booking.checkIn, booking.checkOut);

    return successResponse({
      bookingId: booking.id,
      customerName: booking.customer.name,
      roomNumber: booking.room.roomNumber,
      status: booking.status,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      bookedNights,
      maxRefundable,
      totalWithVat: totals.totalWithVat,
      dueAmount: totals.dueAmount,
    });
  } catch (error) {
    console.error('Cancel preview error:', error);
    return errorResponse('Failed to load cancellation preview', 500);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const authUser = await db.user.findUnique({
      where: { id: authResult.id },
      select: { id: true, active: true },
    });
    if (!authUser?.active) {
      return errorResponse('Session expired. Please log out and log in again.', 401);
    }

    const { id } = await params;
    const body = await request.json();
    const refundEnabled = Boolean(body.refundEnabled);
    const refundMode =
      body.refundMode === 'amount' ? ('amount' as const) : ('percent' as const);
    const refundPercent = body.refundPercent != null ? parseFloat(String(body.refundPercent)) : 0;
    const refundAmount = body.refundAmount != null ? parseFloat(String(body.refundAmount)) : 0;
    const refundMethod = parsePaymentMethod(body.refundMethod, 'CASH');
    const cancelReason =
      typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

    const booking = await loadBookingForCancel(id);
    if (!booking) return notFoundResponse('Booking');

    if (booking.status === 'CANCELLED') {
      return errorResponse('This reservation is already cancelled');
    }
    if (booking.status === 'CHECKED_OUT') {
      return errorResponse('Checked-out reservations cannot be cancelled');
    }

    const maxRefundable = sumBookingNetPaid(booking.payments);
    let refundTotal = 0;

    if (refundEnabled) {
      if (maxRefundable <= 0) {
        return errorResponse('No payments to refund on this reservation');
      }
      refundTotal = computeRefundFromInput(
        maxRefundable,
        refundMode,
        refundPercent,
        refundAmount
      );
      if (refundTotal <= 0) {
        return errorResponse('Refund amount must be greater than 0');
      }
    }

    const result = await db.$transaction(async (tx) => {
      if (refundTotal > 0) {
        await tx.payment.create({
          data: {
            amount: refundTotal,
            method: refundMethod,
            paymentType: 'REFUND',
            bookingId: id,
            receivedBy: authUser.id,
            notes: cancelReason
              ? `Cancellation refund — ${cancelReason}`
              : 'Cancellation refund',
          },
        });
      }

      if (booking.status === 'CHECKED_IN' || booking.status === 'RESERVED') {
        await tx.room.update({
          where: { id: booking.roomId },
          data: { status: 'AVAILABLE' },
        });
      }

      await tx.restaurantOrder.updateMany({
        where: {
          bookingId: id,
          status: { notIn: ['DELIVERED', 'CANCELLED'] },
        },
        data: { status: 'CANCELLED' },
      });

      await tx.invoice.updateMany({
        where: {
          bookingId: id,
          status: { in: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID'] },
        },
        data: { status: 'CANCELLED' },
      });

      const updated = await tx.booking.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          dueAmount: 0,
          notes: cancelReason
            ? [booking.notes, `Cancelled: ${cancelReason}`].filter(Boolean).join('\n')
            : booking.notes,
        },
        include: {
          customer: true,
          room: { include: { type: true } },
          payments: { select: { amount: true, paymentType: true } },
        },
      });

      return updated;
    });

    await logActivity(
      authUser.id,
      'CANCEL_BOOKING',
      'hotel',
      JSON.stringify({
        bookingId: id,
        refundEnabled,
        refundAmount: refundTotal,
        refundMode: refundEnabled ? refundMode : null,
        reason: cancelReason,
      })
    );

    return successResponse(
      {
        booking: result,
        refundAmount: refundTotal,
      },
      refundTotal > 0
        ? `Reservation cancelled with ${refundTotal} BDT refund`
        : 'Reservation cancelled (no refund)'
    );
  } catch (error) {
    console.error('Cancel booking error:', error);
    return errorResponse('Failed to cancel reservation', 500);
  }
}
