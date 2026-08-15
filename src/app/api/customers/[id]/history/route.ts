import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireHotelAccess } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse } from '@/lib/api-utils';
import {
  bookingVatOptions,
  computeRoomBookingTotals,
  sumBookingFolioRestaurant,
  sumBookingNetPaid,
  sumBookingPostedExtras,
} from '@/lib/booking-totals';
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
    const companionId = searchParams.get('companionId')?.trim() || null;

    const customer = await db.customer.findUnique({
      where: { id },
      include: {
        bookings: {
          orderBy: { checkIn: 'desc' },
          include: {
            room: { include: { type: true } },
            companyLedgerGuest: { select: { registrationNumber: true } },
            sourceReservationEntry: { select: { registrationNumber: true } },
            companions: { orderBy: { sortOrder: 'asc' } },
            invoices: {
              where: { status: { not: 'CANCELLED' } },
              orderBy: { issuedAt: 'desc' },
              take: 1,
            },
            payments: {
              orderBy: { createdAt: 'desc' },
              include: { receiver: { select: { id: true, name: true } } },
            },
            charges: { select: { chargeType: true, amount: true, quantity: true } },
            restaurantOrders: {
              select: {
                status: true,
                billingDisposition: true,
                totalAmount: true,
                companyLedgerBill: { select: { id: true } },
              },
            },
          },
        },
      },
    });

    if (!customer) return notFoundResponse('Customer');

    const companion = companionId
      ? customer.bookings
          .flatMap((booking) => booking.companions.map((c) => ({ companion: c, booking })))
          .find(({ companion: c }) => c.id === companionId) ?? null
      : null;

    if (companionId && !companion) return notFoundResponse('Companion');

    const isCompanionView = Boolean(companion);
    const filteredBookings = customer.bookings.filter((booking) => {
      if (booking.status === 'CANCELLED') return false;
      if (companion && booking.id !== companion.booking.id) return false;
      if (!dateFrom && !dateTo) return true;
      return guestStayOverlapsRange(booking, dateFrom, dateTo);
    });

    const mapCompanion = (c: {
      id: string
      name: string
      phone: string | null
      email: string | null
      nationality: string | null
    }) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      nationality: c.nationality,
      role: 'companion' as const,
    });

    const stays = filteredBookings.map((booking) => {
      const totalPaid = sumBookingNetPaid(booking.payments);
      const totals = computeRoomBookingTotals(
        booking.totalRoomCharge,
        totalPaid,
        bookingVatOptions(booking)
      );
      const extraChargesTotal = sumBookingPostedExtras(booking.charges, booking.payments);
      const restaurantChargesTotal = sumBookingFolioRestaurant(booking.restaurantOrders);
      const invoice = booking.invoices[0] ?? null;
      const registrationNumber = resolveBookingRegistrationNumber(booking);
      const stayCompanions = booking.companions
        .filter((c) => c.name.trim())
        .map(mapCompanion);

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
          totalRoomCharge: isCompanionView ? 0 : booking.totalRoomCharge,
          dueAmount: isCompanionView ? 0 : totals.dueAmount,
          totalWithVat: isCompanionView
            ? 0
            : totals.totalWithVat + extraChargesTotal + restaurantChargesTotal,
          paidAmount: isCompanionView ? 0 : totalPaid,
          room: booking.room,
        },
        companions: stayCompanions,
        invoice:
          isCompanionView || !invoice
            ? null
            : {
                id: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                totalAmount: invoice.totalAmount,
                paidAmount: invoice.paidAmount,
                dueAmount: invoice.dueAmount,
                status: invoice.status,
                issuedAt: invoice.issuedAt,
              },
        payments: isCompanionView
          ? []
          : booking.payments.map((p) => ({
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

    const totalDue = isCompanionView
      ? 0
      : stays.reduce((sum, stay) => sum + (stay.booking.dueAmount ?? 0), 0);

    const guestProfile = companion
      ? {
          id: companion.companion.id,
          name: companion.companion.name,
          phone: companion.companion.phone ?? '',
          email: companion.companion.email,
          nationality: companion.companion.nationality,
          address: companion.companion.address,
          idType: companion.companion.idType,
          idNumber: companion.companion.idNumber,
          notes: null,
          role: 'companion' as const,
          primaryGuestName: customer.name,
        }
      : {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          nationality: customer.nationality,
          address: customer.address,
          idType: customer.idType,
          idNumber: customer.idNumber,
          notes: customer.notes,
          role: 'primary' as const,
          primaryGuestName: null,
        };

    return successResponse({
      guest: guestProfile,
      stays,
      totalDue,
      stayCount: filteredBookings.length,
    });
  } catch (error) {
    console.error('Customer guest history error:', error);
    return errorResponse('Failed to fetch guest history', 500);
  }
}
