import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import { computeBookingRoomDue, sumBookingNetPaid } from '@/lib/booking-totals';
import { parsePaymentMethod } from '@/lib/payment-method';
import { RoleType } from '@prisma/client';
import { isReservationGuestProfileComplete } from '@/lib/reservation-completion-fields';
import { ensureBookingRegistrationNumber } from '@/lib/guest-registration-number';

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
    if (!authUser || !authUser.active) {
      return errorResponse('Session expired. Please log out and log in again.', 401);
    }

    const { id } = await params;
    const body = await request.json();
    const { initialPayment, paymentMethod, checkInPayments } = body;

    // Fetch the booking
    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        room: { include: { type: true } },
        customer: true,
        idDocuments: true,
      },
    });

    if (!booking) {
      return notFoundResponse('Booking');
    }

    // Validate booking status
    if (booking.status !== 'RESERVED') {
      return errorResponse('Only reserved bookings can be checked in');
    }

    await ensureBookingRegistrationNumber(id);
    const customer = await db.customer.findUnique({ where: { id: booking.customerId } });
    if (!customer) return notFoundResponse('Customer');

    if (
      !isReservationGuestProfileComplete(customer, booking.idDocuments.length, {
        nidPhysicallyReceived: booking.nidPhysicallyReceived,
        isCorporateGuest: booking.isCorporateGuest,
        company: booking.company,
        companyLedgerId: booking.companyLedgerId,
      })
    ) {
      return errorResponse(
        booking.isCorporateGuest
          ? 'Complete the reservation first — corporate guest name, company, phone, designation, and address are required before check-in'
          : 'Complete the reservation first — nationality, ID/passport number, email, address, and required ID details are needed before check-in'
      );
    }

    const checkInPaymentRows: Array<{ amount: number; method: string }> = [];
    if (Array.isArray(checkInPayments)) {
      for (const row of checkInPayments) {
        const amount = parseFloat(String((row as { amount?: unknown }).amount ?? 0));
        if (amount > 0) {
          checkInPaymentRows.push({
            amount,
            method: String((row as { method?: string }).method ?? 'CASH'),
          });
        }
      }
    } else {
      const legacyAmount = initialPayment ? parseFloat(String(initialPayment)) : 0;
      if (legacyAmount > 0) {
        checkInPaymentRows.push({
          amount: legacyAmount,
          method: String(paymentMethod ?? 'CASH'),
        });
      }
    }
    const initialPaymentAmount = checkInPaymentRows.reduce((sum, row) => sum + row.amount, 0);

    // Update room status to OCCUPIED
    await db.room.update({
      where: { id: booking.roomId },
      data: { status: 'OCCUPIED' },
    });

    for (const row of checkInPaymentRows) {
      await db.payment.create({
        data: {
          amount: row.amount,
          method: parsePaymentMethod(row.method, 'CASH'),
          paymentType: 'INITIAL',
          bookingId: id,
          receivedBy: authUser.id,
          notes: 'Initial payment at check-in',
        },
      });
    }

    const bookingPayments = await db.payment.findMany({
      where: { bookingId: id },
      select: { amount: true, paymentType: true },
    });
    const totalPaid = sumBookingNetPaid(bookingPayments);
    const { dueAmount } = computeBookingRoomDue(booking, bookingPayments);

    const updatedBooking = await db.booking.update({
      where: { id },
      data: {
        status: 'CHECKED_IN',
        isInitialReservation: false,
        actualCheckIn: new Date(),
        initialPayment: (booking.initialPayment || 0) + initialPaymentAmount,
        dueAmount,
      },
      include: {
        customer: true,
        room: { include: { type: true } },
      },
    });

    await logActivity(
      authUser.id,
      'CHECK_IN',
      'hotel',
      JSON.stringify({
        bookingId: id,
        roomId: booking.roomId,
        customerName: booking.customer.name,
        initialPayment: initialPaymentAmount,
        dueAmount,
      })
    );

    return successResponse(updatedBooking, 'Check-in successful');
  } catch (error) {
    console.error('Check-in error:', error);
    return errorResponse('Failed to check in', 500);
  }
}
