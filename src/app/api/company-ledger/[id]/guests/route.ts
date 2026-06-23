import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import { buildGuestStayFilterWhere } from '@/lib/business-date';
import {
  guestStayOverlapsRange,
  parseStayDateRange,
  pickGuestStayBooking,
} from '@/lib/guest-stay-date-filter';
import { Prisma, RoleType } from '@prisma/client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { id: companyLedgerId } = await params;
    const company = await db.companyLedger.findUnique({ where: { id: companyLedgerId } });
    if (!company) return notFoundResponse('Company ledger');

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim() || '';
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    const where: Prisma.CompanyLedgerGuestWhereInput = { companyLedgerId };

    if (search) {
      const orConditions: Prisma.CompanyLedgerGuestWhereInput[] = [
        { guestName: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
        { nationality: { contains: search } },
        { registrationNumber: { contains: search } },
        { address: { contains: search } },
        { idNumber: { contains: search } },
        {
          bookings: {
            some: {
              OR: [
                { registrationNumber: { contains: search } },
                { customer: { registrationNumber: { contains: search } } },
              ],
            },
          },
        },
      ];
      const searchDigits = search.replace(/\D/g, '');
      if (searchDigits.length >= 6) {
        orConditions.push({ phone: { contains: searchDigits.slice(-10) } });
      }
      if (searchDigits.length >= 4) {
        orConditions.push({ registrationNumber: { contains: searchDigits } });
        orConditions.push({
          bookings: {
            some: {
              OR: [
                { registrationNumber: { contains: searchDigits } },
                { customer: { registrationNumber: { contains: searchDigits } } },
              ],
            },
          },
        });
      }
      where.OR = orConditions;
    }

    const stayOverlapFilter = await buildGuestStayFilterWhere(dateFrom, dateTo);
    if (stayOverlapFilter) {
      where.bookings = { some: stayOverlapFilter };
    }

    const guests = await db.companyLedgerGuest.findMany({
      where,
      orderBy: { guestName: 'asc' },
      include: {
        bookings: {
          where: { status: { not: 'CANCELLED' } },
          select: {
            registrationNumber: true,
            checkIn: true,
            checkOut: true,
            actualCheckIn: true,
            actualCheckOut: true,
            status: true,
            companyLedgerBill: {
              select: {
                dueAmount: true,
                totalAmount: true,
              },
            },
          },
          orderBy: { checkIn: 'desc' },
        },
      },
    });

    const hasDateFilter = !!parseStayDateRange(dateFrom, dateTo);
    const relevantBookingsFor = (list: typeof guests[0]['bookings']) =>
      hasDateFilter
        ? list.filter((booking) => guestStayOverlapsRange(booking, dateFrom, dateTo))
        : list;

    const data = guests.map(({ bookings, ...guest }) => {
      const primaryStay = pickGuestStayBooking(bookings, dateFrom, dateTo, hasDateFilter);
      const relevantBookings = relevantBookingsFor(bookings);

      const displayRegistrationNumber =
        primaryStay?.registrationNumber?.trim() ||
        relevantBookings.find((b) => b.registrationNumber?.trim())?.registrationNumber?.trim() ||
        guest.registrationNumber?.trim() ||
        null;

      return {
        ...guest,
        registrationNumber: displayRegistrationNumber,
        totalDue: relevantBookings.reduce(
          (sum, booking) => sum + (booking.companyLedgerBill?.dueAmount ?? 0),
          0
        ),
        totalBill: relevantBookings.reduce(
          (sum, booking) => sum + (booking.companyLedgerBill?.totalAmount ?? 0),
          0
        ),
        latestStayCheckIn: bookings[0]?.checkIn ?? null,
        displayStay: primaryStay
          ? {
              checkIn: primaryStay.checkIn,
              checkOut: primaryStay.checkOut,
              actualCheckIn: primaryStay.actualCheckIn,
              actualCheckOut: primaryStay.actualCheckOut,
              status: primaryStay.status,
            }
          : null,
      };
    });

    data.sort((a, b) => {
      const aTime = a.latestStayCheckIn ? new Date(a.latestStayCheckIn).getTime() : 0;
      const bTime = b.latestStayCheckIn ? new Date(b.latestStayCheckIn).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.guestName.localeCompare(b.guestName);
    });

    return successResponse(data);
  } catch (error) {
    console.error('Company ledger guests list error:', error);
    return errorResponse('Failed to fetch company guests', 500);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { id: companyLedgerId } = await params;
    const company = await db.companyLedger.findUnique({ where: { id: companyLedgerId } });
    if (!company) return notFoundResponse('Company ledger');

    const body = await request.json();
    const guestName = String(body?.guestName || '').trim();
    if (!guestName) return errorResponse('Guest name is required');

    const guest = await db.companyLedgerGuest.create({
      data: {
        companyLedgerId,
        guestName,
        phone: body?.phone?.trim() || null,
        email: body?.email?.trim() || null,
        nationality: body?.nationality?.trim() || null,
        registrationNumber: body?.registrationNumber?.trim() || null,
        address: body?.address?.trim() || null,
        idType: body?.idType?.trim() || null,
        idNumber: body?.idNumber?.trim() || null,
        designation: body?.designation?.trim() || null,
        notes: body?.notes?.trim() || null,
      },
    });

    await logActivity(
      authResult.id,
      'CREATE',
      'company-ledger-guest',
      JSON.stringify({
        companyLedgerId,
        companyName: company.name,
        guestId: guest.id,
        guestName: guest.guestName,
      })
    );

    return successResponse(guest, 'Guest added to company ledger', 201);
  } catch (error) {
    console.error('Company ledger guest create error:', error);
    return errorResponse('Failed to add guest', 500);
  }
}
