import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireHotelAccess } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse } from '@/lib/api-utils';
import { bookingVatOptions, computeRoomBookingTotals, sumBookingNetPaid } from '@/lib/booking-totals';
import { guestStayOverlapsRange } from '@/lib/guest-stay-date-filter';
import { resolveBookingRegistrationNumber } from '@/lib/booking-registration';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireHotelAccess(request);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    const customer = await db.customer.findUnique({
      where: { id },
      include: {
        bookings: {
          orderBy: { checkIn: 'desc' },
          include: {
            room: { include: { type: true } },
            companyLedgerGuest: { select: { registrationNumber: true } },
            sourceReservationEntry: { select: { registrationNumber: true } },
            invoices: {
              where: { status: { not: 'CANCELLED' } },
              orderBy: { issuedAt: 'desc' },
              take: 1,
            },
            payments: {
              orderBy: { createdAt: 'desc' },
              include: { receiver: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    if (!customer) return notFoundResponse('Customer');

    const filteredBookings = customer.bookings.filter((booking) => {
      if (booking.status === 'CANCELLED') return false;
      if (!dateFrom && !dateTo) return true;
      return guestStayOverlapsRange(booking, dateFrom, dateTo);
    });

    const stays = filteredBookings.map((booking) => {
      const totalPaid = sumBookingNetPaid(booking.payments);
      const totals = computeRoomBookingTotals(
        booking.totalRoomCharge,
        totalPaid,
        bookingVatOptions(booking)
      );
      const invoice = booking.invoices[0] ?? null;
      const registrationNumber = resolveBookingRegistrationNumber(booking);

      return {
        booking: {
          id: booking.id,
          confirmationNumber: booking.confirmationNumber,
          registrationNumber: registrationNumber || null,
          status: booking.status,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          actualCheckIn: booking.actualCheckIn,
          actualCheckOut: booking.actualCheckOut,
          totalRoomCharge: booking.totalRoomCharge,
          dueAmount: totals.dueAmount,
          totalWithVat: totals.totalWithVat,
          paidAmount: totalPaid,
          room: booking.room,
        },
        invoice: invoice
          ? {
              id: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              totalAmount: invoice.totalAmount,
              paidAmount: invoice.paidAmount,
              dueAmount: invoice.dueAmount,
              status: invoice.status,
              issuedAt: invoice.issuedAt,
            }
          : null,
        payments: booking.payments.map((p) => ({
          id: p.id,
          amount: p.amount,
          method: p.method,
          paymentType: p.paymentType,
          reference: p.reference,
          notes: p.notes,
          createdAt: p.createdAt,
          receiver: p.receiver,
        })),
      };
    });

    const totalDue = stays.reduce((sum, stay) => sum + (stay.booking.dueAmount ?? 0), 0);

    return successResponse({
      guest: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        nationality: customer.nationality,
        address: customer.address,
        idType: customer.idType,
        idNumber: customer.idNumber,
        notes: customer.notes,
      },
      stays,
      totalDue,
      stayCount: customer.bookings.filter((b) => b.status !== 'CANCELLED').length,
    });
  } catch (error) {
    console.error('Customer guest history error:', error);
    return errorResponse('Failed to fetch guest history', 500);
  }
}
