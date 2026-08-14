import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireHotelAccess, requireRole } from '@/lib/auth';
import { successResponse, paginatedResponse, errorResponse, logActivity } from '@/lib/api-utils';
import { generateConfirmationNumber } from '@/lib/confirmation-number.server';
import { attachIdDocumentsToBooking } from '@/lib/booking-id-documents';
import {
  replaceBookingCompanions,
  validateCompanionInputs,
  validateCorporateCompanionInputs,
  type CompanionInput,
} from '@/lib/booking-companions';
import { isNonePaymentMethod, parseReservationPaymentMethod } from '@/lib/payment-method';
import {
  computeBookingRoomDue,
  computeRoomBookingTotals,
  resolveBookingDisplayDue,
  sumBookingNetPaid,
} from '@/lib/booking-totals';
import { formatGuestCompany } from '@/lib/reservation-terms';
import {
  ensureCompanyLedgerGuestFromCustomer,
  resolveCompanyLedgerBooking,
} from '@/lib/company-ledger-billing';
import { resolveBookingCheckInOut } from '@/lib/app-settings';
import { readCurrentBusinessDateString } from '@/lib/business-date';
import { isArrivalOnOrBeforeBusinessDate } from '@/lib/room-effective-status';
import { getRoomNightlyTotal } from '@/lib/room-pricing';
import { Prisma, RoleType } from '@prisma/client';
import { processAllOverdueStayExtensions } from '@/lib/auto-stay-extension';
import { ensureCustomerRegistrationNumber, generateGuestRegistrationNumber } from '@/lib/guest-registration-number';
import { getCorporateGuestMissingFields, getPhysicalIdMissingFields, isReservationGuestProfileComplete } from '@/lib/reservation-completion-fields';
import { hasBookingCompany } from '@/lib/booking-company';
import { buildGuestStayFilterWhere } from '@/lib/business-date';
import { assertRoomAvailableForBooking, listReservationEntries } from '@/lib/reservation-entry';

const bookingListInclude = {
  customer: true,
  room: { include: { type: true } },
  companions: { orderBy: { sortOrder: 'asc' as const } },
  companyLedgerGuest: { select: { registrationNumber: true } },
  sourceReservationEntry: { select: { registrationNumber: true } },
  creator: { select: { id: true, name: true, email: true } },
  payments: { select: { amount: true, paymentType: true } },
  invoices: {
    where: { status: { not: 'CANCELLED' as const } },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { dueAmount: true, status: true },
  },
  _count: { select: { idDocuments: true } },
} satisfies Prisma.BookingInclude;

type BookingListRow = Prisma.BookingGetPayload<{ include: typeof bookingListInclude }>;

function enrichBookingListRow(booking: BookingListRow) {
  const latestInvoice = booking.invoices[0] ?? null;
  const totals = computeBookingRoomDue(booking, booking.payments);
  const dueAmount = resolveBookingDisplayDue(booking, booking.payments, latestInvoice);
  const { payments: _payments, invoices: _invoices, _count, ...rest } = booking;
  return {
    ...rest,
    recordType: 'booking' as const,
    idDocumentCount: _count.idDocuments,
    vatPercent: totals.vatPercent,
    vatAmount: totals.vatAmount,
    totalWithVat: totals.totalWithVat,
    discountAmount: totals.discountAmount,
    dueAmount,
  };
}

function sortMergedBookingList<T extends { checkIn: string | Date; createdAt: string | Date }>(
  items: T[],
  byStayDate: boolean
): T[] {
  return [...items].sort((a, b) => {
    if (byStayDate) {
      return new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime();
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireHotelAccess(request);
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const roomId = searchParams.get('roomId');
    const customerId = searchParams.get('customerId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const search = searchParams.get('search')?.trim();
    // Lookup callers (payment/booking pickers) need real bookings only, never reservation entries.
    const bookingsOnly = searchParams.get('records') === 'bookings';

    if (!bookingsOnly) {
      await processAllOverdueStayExtensions(db);
    }

    const skip = (page - 1) * limit;

    const where: Prisma.BookingWhereInput = {};
    if (status === 'COMPANY') {
      where.companyLedgerId = { not: null };
    } else if (status) {
      where.status = status as Prisma.EnumBookingStatusFilter['equals'];
    }
    if (roomId) where.roomId = roomId;
    if (customerId) where.customerId = customerId;

    if (search) {
      where.OR = [
        { customer: { name: { contains: search } } },
        { customer: { phone: { contains: search } } },
        { customer: { registrationNumber: { contains: search } } },
        { registrationNumber: { contains: search } },
        { companyLedgerGuest: { registrationNumber: { contains: search } } },
        { sourceReservationEntry: { registrationNumber: { contains: search } } },
        { room: { roomNumber: { contains: search } } },
        { confirmationNumber: { contains: search } },
      ];
    }

    // Date range: guests visible on the business day (handles calendar lag before day close)
    const stayOverlapFilter = await buildGuestStayFilterWhere(dateFrom, dateTo);
    if (stayOverlapFilter) {
      const existingAnd = where.AND
        ? Array.isArray(where.AND)
          ? where.AND
          : [where.AND]
        : [];
      where.AND = [...existingAnd, stayOverlapFilter];
    }

    const includeReservationEntries = !status && !bookingsOnly;

    if (includeReservationEntries) {
      const entryScope =
        dateFrom && dateTo && dateFrom === dateTo ? ('business_day' as const) : ('all' as const);

      const [{ rows: entryRows }, allBookings] = await Promise.all([
        listReservationEntries({
          page: 1,
          limit: 500,
          dateFrom,
          dateTo,
          search,
          scope: entryScope,
          businessDate: entryScope === 'business_day' ? dateFrom : null,
        }),
        db.booking.findMany({
          where,
          include: bookingListInclude,
          orderBy:
            dateFrom || dateTo
              ? [{ status: 'asc' }, { checkIn: 'asc' }]
              : { createdAt: 'desc' },
        }),
      ]);

      const enrichedBookings = allBookings.map(enrichBookingListRow);
      const merged = sortMergedBookingList(
        [...entryRows, ...enrichedBookings],
        !!(dateFrom || dateTo)
      );
      const total = merged.length;
      const paged = merged.slice(skip, skip + limit);

      return paginatedResponse(paged, total, page, limit);
    }

    const [bookings, total] = await Promise.all([
      db.booking.findMany({
        where,
        include: bookingListInclude,
        skip,
        take: limit,
        orderBy:
          dateFrom || dateTo
            ? [{ status: 'asc' }, { checkIn: 'asc' }]
            : { createdAt: 'desc' },
      }),
      db.booking.count({ where }),
    ]);

    const enriched = bookings.map(enrichBookingListRow);

    return paginatedResponse(enriched, total, page, limit);
  } catch (error) {
    console.error('Bookings list error:', error);
    return errorResponse('Failed to fetch bookings', 500);
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const {
      customerId,
      roomId,
      checkIn,
      checkOut,
      adults,
      children,
      advancePayment,
      notes,
      idDocumentPaths,
      vatApplied,
      vatPercent: vatPercentBody,
      checkInNow,
      paymentMethod,
      company,
      isInitialReservation,
      withMeal,
      discountEnabled,
      discountType,
      discountValue,
      companyLedgerId,
      nationality: nationalityBody,
      companions,
      nidPhysicallyReceived,
      serviceChargePercent: serviceChargePercentBody,
      bookingPayments,
      isCorporateGuest,
    } = body;

    const corporateGuest = isCorporateGuest === true;
    const initialReservation = isCorporateGuest ? false : isInitialReservation === true;

    if (initialReservation && checkInNow === true) {
      return errorResponse(
        'Initial reservations cannot be checked in immediately. Complete guest ID details first, then check in from bookings.'
      );
    }

    if (!customerId || !roomId || !checkIn || !checkOut) {
      return errorResponse('Customer ID, room ID, check-in and check-out dates are required');
    }

    // Verify customer exists
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return errorResponse('Customer not found');
    }

    if (!customer.nationality?.trim() && !corporateGuest) {
      return errorResponse('Guest nationality is required');
    }

    const adultCount = Math.max(1, parseInt(String(adults ?? 1), 10) || 1);
    const childCount = Math.max(0, parseInt(String(children ?? 0), 10) || 0);
    const nidReceived = corporateGuest ? false : nidPhysicallyReceived !== false;
    const hasCompanySelected = hasBookingCompany({
      companyLedgerId: companyLedgerId ?? null,
      company: company ?? customer.company,
    });
    if (!corporateGuest) {
      const companionError = validateCompanionInputs(
        adultCount,
        childCount,
        (companions as CompanionInput[]) ?? [],
        { requireIdFields: nidReceived || !hasCompanySelected }
      );
      if (companionError) {
        return errorResponse(companionError);
      }
    }

    if (nidReceived && !corporateGuest) {
      const idMissing = getPhysicalIdMissingFields({
        idNumber: customer.idNumber ?? '',
        idType: customer.idType ?? '',
        nationality: customer.nationality ?? '',
      });
      if (idMissing.length > 0) {
        return errorResponse(`Required when ID documents are physically received: ${idMissing.join(', ')}`);
      }
    }

    if (corporateGuest) {
      const corporateMissing = getCorporateGuestMissingFields({
        guestName: customer.name,
        guestCompany: customer.company ?? '',
        guestPhone: customer.phone,
        guestDesignation: customer.designation ?? '',
        guestAddress: customer.address ?? '',
      });
      if (corporateMissing.length > 0) {
        return errorResponse(`Corporate guest details required: ${corporateMissing.join(', ')}`);
      }

      const companionError = validateCorporateCompanionInputs(
        adultCount,
        ((companions as CompanionInput[]) ?? []).map((c) => ({
          name: c.name,
          company: c.company ?? '',
          phone: c.phone ?? '',
          designation: c.designation ?? '',
          address: c.address ?? '',
        }))
      );
      if (companionError) {
        return errorResponse(companionError);
      }
    }

    await ensureCustomerRegistrationNumber(customerId);

    const bookingRegistrationNumber = await generateGuestRegistrationNumber();

    // Verify room exists and is available
    const room = await db.room.findUnique({
      where: { id: roomId },
      include: { type: true },
    });
    if (!room) {
      return errorResponse('Room not found');
    }

    if (['OCCUPIED', 'CLEANING', 'MAINTENANCE'].includes(room.status)) {
      return errorResponse(
        `Room is not available for booking (current status: ${room.status.toLowerCase().replace('_', ' ')})`
      );
    }

    let checkInDate: Date;
    let checkOutDate: Date;
    let days: number;
    try {
      const resolved = await resolveBookingCheckInOut(checkIn, checkOut, {
        walkInNow: checkInNow === true,
      });
      checkInDate = resolved.checkIn;
      checkOutDate = resolved.checkOut;
      days = resolved.nights;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Check-out date must be after check-in date';
      return errorResponse(message);
    }

    // Prevent overlapping active bookings for the same room.
    const overlappingBooking = await db.booking.findFirst({
      where: {
        roomId,
        status: { in: ['RESERVED', 'CHECKED_IN'] },
        checkIn: { lt: checkOutDate },
        checkOut: { gt: checkInDate },
      },
      include: {
        customer: { select: { name: true } },
      },
    });
    if (overlappingBooking) {
      return errorResponse(
        `Room already has an active booking in this date range${overlappingBooking.customer?.name ? ` (${overlappingBooking.customer.name})` : ''}`
      );
    }

    const entryBlockError = await assertRoomAvailableForBooking(
      roomId,
      room.typeId,
      checkInDate,
      checkOutDate
    );
    if (entryBlockError) {
      return errorResponse(entryBlockError);
    }

    // Room totalPrice is inclusive of VAT and service charge
    const totalRoomCharge = days * getRoomNightlyTotal(room);
    const paymentLines: Array<{ amount: number; method: ReturnType<typeof parseReservationPaymentMethod> }> = [];
    if (Array.isArray(bookingPayments)) {
      for (const row of bookingPayments) {
        const amount = parseFloat(String((row as { amount?: unknown }).amount ?? 0));
        if (amount > 0) {
          paymentLines.push({
            amount,
            method: parseReservationPaymentMethod((row as { method?: string }).method),
          });
        }
      }
    }
    const advance =
      paymentLines.length > 0
        ? paymentLines.reduce((sum, p) => sum + p.amount, 0)
        : advancePayment
          ? parseFloat(String(advancePayment))
          : 0;
    const applyVat = vatApplied === true;
    let bookingVatPercent = 0;
    if (applyVat) {
      bookingVatPercent = 15;
      if (vatPercentBody !== undefined && vatPercentBody !== null && vatPercentBody !== '') {
        const parsed = parseFloat(String(vatPercentBody));
        if (!Number.isNaN(parsed) && parsed >= 0) bookingVatPercent = parsed;
      }
    }
    let bookingServiceChargePercent = 10;
    if (serviceChargePercentBody !== undefined && serviceChargePercentBody !== null && serviceChargePercentBody !== '') {
      const parsed = parseFloat(String(serviceChargePercentBody));
      if (!Number.isNaN(parsed) && parsed >= 0) bookingServiceChargePercent = parsed;
    }
    const applyDiscount = discountEnabled === true;
    const resolvedDiscountType = discountType === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    const resolvedDiscountValue = applyDiscount
      ? Math.max(0, parseFloat(String(discountValue ?? 0)) || 0)
      : 0;

    const { dueAmount } = computeRoomBookingTotals(
      totalRoomCharge,
      advance,
      {
        vatApplied: applyVat,
        vatPercent: bookingVatPercent,
      },
      {
        discountEnabled: applyDiscount,
        discountType: resolvedDiscountType,
        discountValue: resolvedDiscountValue,
      }
    );

    const confirmationNumber = await generateConfirmationNumber();
    let resolvedCompany = corporateGuest
      ? (company?.trim() || customer.company?.trim() || null)
      : formatGuestCompany(company ?? customer.company);
    let resolvedCompanyLedgerId: string | null = null;
    let resolvedCompanyLedgerGuestId: string | null = null;

    if (companyLedgerId) {
      const ledgerResult = await resolveCompanyLedgerBooking(db, companyLedgerId, null);
      if ('error' in ledgerResult) {
        return errorResponse(ledgerResult.error);
      }
      resolvedCompanyLedgerId = ledgerResult.companyLedgerId;
      resolvedCompany = ledgerResult.companyName;
      resolvedCompanyLedgerGuestId = await ensureCompanyLedgerGuestFromCustomer(
        db,
        resolvedCompanyLedgerId,
        {
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          nationality: customer.nationality,
          registrationNumber: bookingRegistrationNumber,
          address: customer.address,
          idType: customer.idType,
          idNumber: customer.idNumber,
        }
      );
    }

    const booking = await db.booking.create({
      data: {
        confirmationNumber,
        registrationNumber: bookingRegistrationNumber,
        customerId,
        roomId,
        company: resolvedCompany,
        companyLedgerId: resolvedCompanyLedgerId,
        companyLedgerGuestId: resolvedCompanyLedgerGuestId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        adults: adultCount,
        children: childCount,
        totalRoomCharge,
        advancePayment: advance,
        dueAmount,
        vatApplied: applyVat,
        vatPercent: bookingVatPercent,
        serviceChargePercent: bookingServiceChargePercent,
        nidPhysicallyReceived: nidReceived,
        notes,
        isInitialReservation: initialReservation,
        isCorporateGuest: corporateGuest,
        withMeal: withMeal === true,
        discountEnabled: applyDiscount,
        discountType: applyDiscount ? resolvedDiscountType : null,
        discountValue: applyDiscount ? resolvedDiscountValue : 0,
        createdBy: authUser.id,
      },
      include: {
        customer: true,
        room: { include: { type: true } },
      },
    });

    await attachIdDocumentsToBooking(
      booking.id,
      Array.isArray(idDocumentPaths) ? idDocumentPaths : undefined
    );
    await replaceBookingCompanions(
      db,
      booking.id,
      (companions as CompanionInput[]) ?? []
    );

    const resolvedPaymentMethod = parseReservationPaymentMethod(paymentMethod);

    if (paymentLines.length > 0) {
      for (const line of paymentLines) {
        if (line.amount > 0 && !isNonePaymentMethod(line.method)) {
          await db.payment.create({
            data: {
              amount: line.amount,
              method: line.method,
              paymentType: 'ADVANCE',
              bookingId: booking.id,
              receivedBy: authResult.id,
              notes: 'Advance payment at booking creation',
            },
          });
        }
      }
    } else if (advance > 0 && !isNonePaymentMethod(resolvedPaymentMethod)) {
      await db.payment.create({
        data: {
          amount: advance,
          method: resolvedPaymentMethod,
          paymentType: 'ADVANCE',
          bookingId: booking.id,
          receivedBy: authResult.id,
          notes: 'Advance payment at booking creation',
        },
      });
    }

    if (checkInNow === true) {
      const idDocCount = Array.isArray(idDocumentPaths) ? idDocumentPaths.length : 0;
      const customerForCheckIn = await db.customer.findUnique({ where: { id: customerId } });
      if (
        !customerForCheckIn ||
        !isReservationGuestProfileComplete(customerForCheckIn, idDocCount, {
          nidPhysicallyReceived: nidReceived,
          isCorporateGuest: corporateGuest,
          company: company ?? customerForCheckIn.company,
          companyLedgerId: companyLedgerId ?? null,
        })
      ) {
        return errorResponse(
          corporateGuest
            ? 'Complete corporate guest details before check-in'
            : 'Complete guest profile (nationality, ID, email, address, and ID documents as required) before check-in'
        );
      }

      await db.room.update({
        where: { id: roomId },
        data: { status: 'OCCUPIED' },
      });

      const paymentRows = await db.payment.findMany({
        where: { bookingId: booking.id },
        select: { amount: true, paymentType: true },
      });
      const totalPaid = sumBookingNetPaid(paymentRows);
      const { dueAmount: dueAfterCheckIn } = computeBookingRoomDue(
        {
          totalRoomCharge,
          vatApplied: applyVat,
          vatPercent: bookingVatPercent,
          discountEnabled: applyDiscount,
          discountType: resolvedDiscountType,
          discountValue: resolvedDiscountValue,
        },
        paymentRows
      );

      await db.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CHECKED_IN',
          actualCheckIn: new Date(),
          dueAmount: dueAfterCheckIn,
        },
      });
    } else {
      const businessDate = await readCurrentBusinessDateString();
      if (isArrivalOnOrBeforeBusinessDate(checkInDate, businessDate)) {
        await db.room.update({
          where: { id: roomId },
          data: { status: 'RESERVED' },
        });
      }
    }

    await logActivity(
      authResult.id,
      'CREATE_BOOKING',
      'hotel',
      JSON.stringify({
        bookingId: booking.id,
        customerId,
        roomId,
        totalRoomCharge,
        advancePayment: advance,
        dueAmount,
        checkedIn: checkInNow === true,
      })
    );

    const bookingWithDocs = await db.booking.findUnique({
      where: { id: booking.id },
      include: {
        customer: true,
        room: { include: { type: true } },
        idDocuments: { orderBy: { sortOrder: 'asc' } },
      },
    });

    return successResponse(bookingWithDocs ?? booking, 'Booking created successfully', 201);
  } catch (error) {
    console.error('Booking creation error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to create booking';
    return errorResponse(
      process.env.NODE_ENV === 'development' ? message : 'Failed to create booking',
      500
    );
  }
}
