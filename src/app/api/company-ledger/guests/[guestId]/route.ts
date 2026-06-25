import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import { resolveBookingRegistrationNumber } from '@/lib/booking-registration';
import { bookingVatOptions, computeRoomBookingTotals, sumBookingNetPaid } from '@/lib/booking-totals';
import { RoleType } from '@prisma/client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ guestId: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { guestId } = await params;
    const guest = await db.companyLedgerGuest.findUnique({
      where: { id: guestId },
      include: {
        companyLedger: {
          select: {
            id: true,
            name: true,
            contactPerson: true,
            phone: true,
            email: true,
            address: true,
            totalBilled: true,
            totalPaid: true,
            dueAmount: true,
          },
        },
        bookings: {
          orderBy: { checkIn: 'desc' },
          include: {
            room: { include: { type: true } },
            customer: { select: { id: true, name: true, phone: true, email: true } },
            companyLedgerBill: true,
            invoices: { orderBy: { issuedAt: 'desc' } },
            payments: {
              orderBy: { createdAt: 'desc' },
              include: { receiver: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    if (!guest) return notFoundResponse('Company ledger guest');

    const stays = guest.bookings.map((booking) => {
      const totalPaid = sumBookingNetPaid(booking.payments);
      const totals = computeRoomBookingTotals(
        booking.totalRoomCharge,
        totalPaid,
        bookingVatOptions(booking)
      );
      const invoice = booking.invoices[0] ?? null;
      return {
        booking: {
          id: booking.id,
          confirmationNumber: booking.confirmationNumber,
          registrationNumber: resolveBookingRegistrationNumber(booking),
          status: booking.status,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          actualCheckIn: booking.actualCheckIn,
          actualCheckOut: booking.actualCheckOut,
          totalRoomCharge: booking.totalRoomCharge,
          dueAmount: totals.dueAmount,
          totalWithVat: totals.totalWithVat,
          room: booking.room,
          customer: booking.customer,
        },
        bill: booking.companyLedgerBill,
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

    const totalDue = stays.reduce((sum, stay) => sum + (stay.bill?.dueAmount ?? 0), 0);

    return successResponse({
      guest: {
        id: guest.id,
        guestName: guest.guestName,
        phone: guest.phone,
        email: guest.email,
        nationality: guest.nationality,
        registrationNumber: guest.registrationNumber,
        address: guest.address,
        idType: guest.idType,
        idNumber: guest.idNumber,
        designation: guest.designation,
        notes: guest.notes,
        createdAt: guest.createdAt,
        updatedAt: guest.updatedAt,
      },
      company: guest.companyLedger,
      stays,
      totalDue,
    });
  } catch (error) {
    console.error('Company ledger guest history error:', error);
    return errorResponse('Failed to fetch guest history', 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ guestId: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { guestId } = await params;
    const existing = await db.companyLedgerGuest.findUnique({
      where: { id: guestId },
      include: { companyLedger: { select: { name: true } } },
    });
    if (!existing) return notFoundResponse('Company ledger guest');

    const body = await request.json();
    const guestName =
      body?.guestName !== undefined ? String(body.guestName).trim() : existing.guestName;
    if (!guestName) return errorResponse('Guest name is required');

    const guest = await db.companyLedgerGuest.update({
      where: { id: guestId },
      data: {
        guestName,
        phone: body?.phone !== undefined ? body.phone?.trim() || null : existing.phone,
        email: body?.email !== undefined ? body.email?.trim() || null : existing.email,
        nationality:
          body?.nationality !== undefined ? body.nationality?.trim() || null : existing.nationality,
        registrationNumber:
          body?.registrationNumber !== undefined
            ? body.registrationNumber?.trim() || null
            : existing.registrationNumber,
        address: body?.address !== undefined ? body.address?.trim() || null : existing.address,
        idType: body?.idType !== undefined ? body.idType?.trim() || null : existing.idType,
        idNumber: body?.idNumber !== undefined ? body.idNumber?.trim() || null : existing.idNumber,
        designation:
          body?.designation !== undefined ? body.designation?.trim() || null : existing.designation,
        notes: body?.notes !== undefined ? body.notes?.trim() || null : existing.notes,
      },
    });

    await logActivity(
      authResult.id,
      'UPDATE',
      'company-ledger-guest',
      JSON.stringify({
        guestId,
        companyName: existing.companyLedger.name,
        guestName: guest.guestName,
      })
    );

    return successResponse(guest, 'Guest updated');
  } catch (error) {
    console.error('Company ledger guest update error:', error);
    return errorResponse('Failed to update guest', 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ guestId: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { guestId } = await params;
    const existing = await db.companyLedgerGuest.findUnique({
      where: { id: guestId },
      include: {
        companyLedger: { select: { name: true } },
        bookings: {
          select: {
            companyLedgerBill: { select: { dueAmount: true } },
          },
        },
      },
    });
    if (!existing) return notFoundResponse('Company ledger guest');

    const guestDue = existing.bookings.reduce(
      (sum, booking) => sum + (booking.companyLedgerBill?.dueAmount ?? 0),
      0
    );
    if (guestDue > 0.009) {
      return errorResponse(
        `Cannot remove guest with outstanding company balance (৳${guestDue.toFixed(2)} due). Settle bills first.`,
        400
      );
    }

    await db.companyLedgerGuest.delete({ where: { id: guestId } });

    await logActivity(
      authResult.id,
      'DELETE',
      'company-ledger-guest',
      JSON.stringify({
        guestId,
        companyName: existing.companyLedger.name,
        guestName: existing.guestName,
      })
    );

    return successResponse(null, 'Guest removed from ledger');
  } catch (error) {
    console.error('Company ledger guest delete error:', error);
    return errorResponse('Failed to delete guest', 500);
  }
}
