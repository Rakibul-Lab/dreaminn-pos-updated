import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireHotelAccess, requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import { ensureConfirmationNumber } from '@/lib/confirmation-number.server';
import {
  computeBookingRoomDue,
  resolveBookingDisplayDue,
  sumBookingFolioRestaurant,
  sumBookingPostedExtras,
} from '@/lib/booking-totals';
import { formatFormOfPayment, getAdvancePaymentMethod } from '@/lib/payment-method';
import { RoleType } from '@prisma/client';
import { resolveBookingCheckInOut } from '@/lib/app-settings';
import { countBookedNights } from '@/lib/booking-stay';
import { replaceIdDocumentsForBooking } from '@/lib/booking-id-documents';
import {
  replaceBookingCompanions,
  validateCompanionInputs,
  validateCorporateCompanionInputs,
  type CompanionInput,
} from '@/lib/booking-companions';
import { formatGuestCompany } from '@/lib/reservation-terms';
import { getCompleteReservationMissingFields, getCorporateGuestMissingFields } from '@/lib/reservation-completion-fields';
import { hasBookingCompany } from '@/lib/booking-company';
import { ensureCustomerRegistrationNumber, ensureBookingRegistrationNumber } from '@/lib/guest-registration-number';
import { getRoomNightlyTotal } from '@/lib/room-pricing';
import { getEmailValidationError } from '@/lib/email-validation';
import { assertRoomAvailableForBooking } from '@/lib/reservation-entry';
import {
  resolveCompanyLedgerBooking,
  ensureCompanyLedgerGuestFromCustomer,
  postCompanyLedgerBill,
} from '@/lib/company-ledger-billing';
import { readCurrentBusinessDateString } from '@/lib/business-date';
import { isArrivalOnOrBeforeBusinessDate } from '@/lib/room-effective-status';
import { isolateBookingCustomer, reassignBookingPrimaryCustomer } from '@/lib/booking-customer-isolation';
import { isValidPhone } from '@/lib/phone';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireHotelAccess(request);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;

    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        customer: true,
        room: { include: { type: true } },
        sourceReservationEntry: { select: { registrationNumber: true } },
        companyLedgerGuest: { select: { registrationNumber: true } },
        creator: { select: { id: true, name: true, email: true, phone: true, role: true } },
        charges: true,
        payments: true,
        restaurantOrders: {
          include: {
            items: { include: { menuItem: true } },
            companyLedgerBill: { select: { id: true } },
          },
        },
        invoices: true,
        idDocuments: { orderBy: { sortOrder: 'asc' } },
        companions: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!booking) {
      return notFoundResponse('Booking');
    }

    const latestInvoice =
      booking.invoices
        ?.filter((invoice) => invoice.status !== 'CANCELLED')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    const totals = computeBookingRoomDue(booking, booking.payments);
    const dueAmount = resolveBookingDisplayDue(
      booking,
      booking.payments,
      latestInvoice
    );
    const advanceMethod = getAdvancePaymentMethod(booking.payments);
    const extraChargesTotal = sumBookingPostedExtras(booking.charges, booking.payments);
    const restaurantChargesTotal = sumBookingFolioRestaurant(booking.restaurantOrders);
    const enriched = {
      ...booking,
      vatPercent: totals.vatPercent,
      vatAmount: totals.vatAmount,
      extraChargesTotal,
      restaurantChargesTotal,
      totalWithVat: totals.totalWithVat + extraChargesTotal + restaurantChargesTotal,
      dueAmount,
      formOfPayment: formatFormOfPayment(booking.advancePayment, advanceMethod),
    };

    if (!booking.confirmationNumber) {
      const confirmationNumber = await ensureConfirmationNumber(id);
      return successResponse({ ...enriched, confirmationNumber });
    }

    return successResponse(enriched);
  } catch (error) {
    console.error('Booking fetch error:', error);
    return errorResponse('Failed to fetch booking', 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;
    const body = await request.json();

    const existing = await db.booking.findUnique({
      where: { id },
      include: {
        customer: true,
        idDocuments: true,
      },
    });
    if (!existing) {
      return notFoundResponse('Booking');
    }

    const isIdDocumentOnlyUpdate =
      Array.isArray(body.idDocumentPaths) &&
      body.customer === undefined &&
      body.roomId === undefined &&
      body.checkIn === undefined &&
      body.checkOut === undefined &&
      body.isInitialReservation === undefined &&
      body.companions === undefined &&
      body.nidPhysicallyReceived === undefined;

    if (
      isIdDocumentOnlyUpdate &&
      (existing.status === 'CHECKED_IN' || existing.status === 'RESERVED')
    ) {
      // Don't rewrite ID path on a Customer shared with other bookings.
      const customerId = await isolateBookingCustomer(id, existing.customerId)
      await replaceIdDocumentsForBooking(id, body.idDocumentPaths);
      const firstPath = body.idDocumentPaths.find(
        (p: unknown) => typeof p === 'string' && p.startsWith('/uploads/id-docs/')
      );
      if (firstPath) {
        await db.customer.update({
          where: { id: customerId },
          data: { idDocPath: firstPath },
        });
      }
      const booking = await db.booking.findUnique({
        where: { id },
        include: {
          customer: true,
          room: { include: { type: true } },
          idDocuments: { orderBy: { sortOrder: 'asc' } },
          companions: { orderBy: { sortOrder: 'asc' } },
        },
      });
      return successResponse(booking, 'ID documents updated');
    }

    if (existing.status !== 'RESERVED' && existing.status !== 'CHECKED_IN') {
      return errorResponse('Only active bookings (reserved or checked-in) can be edited');
    }

    const updateData: Record<string, unknown> = {};
    if (body.adults !== undefined) updateData.adults = parseInt(String(body.adults));
    if (body.children !== undefined) updateData.children = parseInt(String(body.children));
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.company !== undefined) {
      const trimmedCompany = typeof body.company === 'string' ? body.company.trim() : '';
      // On edit, a blank company means "leave as-is" — never reset an existing
      // company to the default walk-in value.
      if (trimmedCompany) updateData.company = formatGuestCompany(trimmedCompany);
    }
    if (body.companyLedgerId !== undefined) {
      const ledgerId =
        typeof body.companyLedgerId === 'string' ? body.companyLedgerId.trim() : '';
      if (!ledgerId) {
        updateData.companyLedgerId = null;
        updateData.companyLedgerGuestId = null;
      } else {
        const ledgerResult = await resolveCompanyLedgerBooking(db, ledgerId, null);
        if ('error' in ledgerResult) {
          return errorResponse(ledgerResult.error);
        }
        updateData.companyLedgerId = ledgerResult.companyLedgerId;
        updateData.company = ledgerResult.companyName;
      }
    }
    if (body.withMeal !== undefined) updateData.withMeal = body.withMeal === true;
    if (body.discountEnabled !== undefined) {
      updateData.discountEnabled = body.discountEnabled === true;
    }
    if (body.discountType !== undefined) {
      updateData.discountType = body.discountType === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    }
    if (body.discountValue !== undefined) {
      updateData.discountValue = Math.max(0, parseFloat(String(body.discountValue)) || 0);
    }

    if (body.vatPercent !== undefined) {
      const parsed = parseFloat(String(body.vatPercent));
      if (!Number.isNaN(parsed) && parsed >= 0) updateData.vatPercent = parsed;
    }
    if (body.vatApplied !== undefined) {
      updateData.vatApplied = body.vatApplied === true;
    }
    if (body.serviceChargePercent !== undefined) {
      const parsed = parseFloat(String(body.serviceChargePercent));
      if (!Number.isNaN(parsed) && parsed >= 0) updateData.serviceChargePercent = parsed;
    }

    if (body.isInitialReservation === false) {
      updateData.isInitialReservation = false;
    }

    if (body.roomId && body.roomId !== existing.roomId) {
      const room = await db.room.findUnique({ where: { id: body.roomId } });
      if (!room) {
        return errorResponse('Room not found');
      }
      if (existing.status === 'CHECKED_IN') {
        if (!['AVAILABLE', 'CLEANING'].includes(room.status)) {
          return errorResponse(
            `Room is not available for transfer (current status: ${room.status.toLowerCase().replace('_', ' ')})`
          );
        }
      } else if (['MAINTENANCE', 'OCCUPIED'].includes(room.status)) {
        return errorResponse(
          `Room is not available for booking (current status: ${room.status.toLowerCase().replace('_', ' ')})`
        );
      }
      updateData.roomId = body.roomId;
    }

    const roomId = (body.roomId as string) || existing.roomId;

    if (body.checkIn !== undefined || body.checkOut !== undefined) {
      try {
        const resolved = await resolveBookingCheckInOut(
          body.checkIn ?? existing.checkIn,
          body.checkOut ?? existing.checkOut
        );
        updateData.checkIn = resolved.checkIn;
        updateData.checkOut = resolved.checkOut;
      } catch {
        return errorResponse('Check-out date must be after check-in date');
      }
    }

    const newCheckIn = (updateData.checkIn as Date) ?? existing.checkIn;
    const newCheckOut = (updateData.checkOut as Date) ?? existing.checkOut;

    const chargeFieldsChanged =
      body.checkIn !== undefined ||
      body.checkOut !== undefined ||
      body.roomId !== undefined ||
      body.discountEnabled !== undefined ||
      body.discountType !== undefined ||
      body.discountValue !== undefined ||
      body.vatPercent !== undefined ||
      body.vatApplied !== undefined;

    if (chargeFieldsChanged) {
      const overlappingBooking = await db.booking.findFirst({
        where: {
          id: { not: id },
          roomId,
          status: { in: ['RESERVED', 'CHECKED_IN'] },
          checkIn: { lt: newCheckOut },
          checkOut: { gt: newCheckIn },
        },
      });
      if (overlappingBooking) {
        return errorResponse('Room already has an active booking in this date range');
      }

      if (body.checkIn || body.checkOut || body.roomId) {
        const roomForEntryCheck = await db.room.findUnique({
          where: { id: roomId },
          select: { id: true, typeId: true },
        });
        if (roomForEntryCheck) {
          const entryBlockError = await assertRoomAvailableForBooking(
            roomForEntryCheck.id,
            roomForEntryCheck.typeId,
            newCheckIn,
            newCheckOut,
            undefined,
            id
          );
          if (entryBlockError) {
            return errorResponse(entryBlockError);
          }
        }
      }

      const room = await db.room.findUnique({
        where: { id: roomId },
        include: { type: true },
      });

      if (room) {
        const days = countBookedNights(newCheckIn, newCheckOut);
        if (days > 0) {
          const totalRoomCharge = days * getRoomNightlyTotal(room);
          const paymentRows = await db.payment.findMany({
            where: { bookingId: id },
            select: { amount: true, paymentType: true },
          });
          const mergedBooking = {
            ...existing,
            ...updateData,
            totalRoomCharge,
            vatPercent:
              (updateData.vatPercent as number | undefined) ?? existing.vatPercent,
            vatApplied:
              (updateData.vatApplied as boolean | undefined) ?? existing.vatApplied,
            discountEnabled:
              (updateData.discountEnabled as boolean | undefined) ?? existing.discountEnabled,
            discountType:
              (updateData.discountType as string | undefined) ?? existing.discountType,
            discountValue:
              (updateData.discountValue as number | undefined) ?? existing.discountValue,
          };
          const oldRoomDue = computeBookingRoomDue(existing, paymentRows).dueAmount;
          const newRoomDue = computeBookingRoomDue(mergedBooking, paymentRows).dueAmount;
          updateData.totalRoomCharge = totalRoomCharge;
          if (existing.status === 'CHECKED_IN') {
            const roomDueDelta = newRoomDue - oldRoomDue;
            updateData.dueAmount = Math.max(0, (existing.dueAmount ?? 0) + roomDueDelta);
          } else {
            updateData.dueAmount = newRoomDue;
          }
        }
      }
    }

    const customerPatch = body.customer as Record<string, unknown> | undefined;
    const replacePrimaryGuest = body.replacePrimaryGuest === true;
    const willMutateCustomer =
      !replacePrimaryGuest &&
      (Boolean(customerPatch) ||
        Array.isArray(body.idDocumentPaths) ||
        body.isInitialReservation === false ||
        (typeof body.companyLedgerId === 'string' && body.companyLedgerId.trim() !== ''));

    // Guest profiles may be shared across bookings. Fork before mutating so
    // edits on this stay do not rewrite guest data on other reservations.
    let workingCustomerId = existing.customerId;
    if (replacePrimaryGuest) {
      if (!customerPatch) {
        return errorResponse('New primary guest details are required');
      }
      const nextName = String(customerPatch.name ?? '').trim();
      const nextPhone = String(customerPatch.phone ?? '').trim();
      if (!nextName || !nextPhone) {
        return errorResponse('New primary guest name and phone are required');
      }
      if (!isValidPhone(nextPhone)) {
        return errorResponse('Please enter a valid phone number for the new primary guest');
      }
      if (customerPatch.email !== undefined) {
        const emailValue = customerPatch.email ? String(customerPatch.email).trim() : null;
        const emailError = getEmailValidationError(emailValue, true);
        if (emailError) return errorResponse(emailError);
      }
      try {
        workingCustomerId = await reassignBookingPrimaryCustomer(
          id,
          existing.customerId,
          {
            name: nextName,
            phone: nextPhone,
            email:
              customerPatch.email !== undefined
                ? customerPatch.email
                  ? String(customerPatch.email).trim()
                  : null
                : null,
            address:
              customerPatch.address !== undefined
                ? customerPatch.address
                  ? String(customerPatch.address).trim()
                  : null
                : null,
            company:
              customerPatch.company !== undefined
                ? customerPatch.company
                  ? String(customerPatch.company).trim()
                  : null
                : null,
            designation:
              customerPatch.designation !== undefined
                ? customerPatch.designation
                  ? String(customerPatch.designation).trim()
                  : null
                : null,
            nationality:
              customerPatch.nationality !== undefined
                ? customerPatch.nationality
                  ? String(customerPatch.nationality).trim()
                  : null
                : null,
            idType:
              customerPatch.idType !== undefined ? String(customerPatch.idType || '') || null : null,
            idNumber:
              customerPatch.idNumber !== undefined
                ? customerPatch.idNumber
                  ? String(customerPatch.idNumber).trim()
                  : null
                : null,
            visaExpiryDate:
              customerPatch.visaExpiryDate !== undefined
                ? customerPatch.visaExpiryDate
                  ? String(customerPatch.visaExpiryDate).trim()
                  : null
                : null,
            idDocPath:
              customerPatch.idDocPath !== undefined ? (customerPatch.idDocPath as string | null) : null,
          }
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to assign new primary guest';
        return errorResponse(message);
      }
    } else if (typeof body.customerId === 'string' && body.customerId.trim()) {
      const requestedCustomerId = body.customerId.trim();
      if (requestedCustomerId !== existing.customerId) {
        const targetCustomer = await db.customer.findUnique({
          where: { id: requestedCustomerId },
          select: { id: true },
        });
        if (!targetCustomer) {
          return errorResponse('Guest not found');
        }
        await db.booking.update({
          where: { id },
          data: { customerId: requestedCustomerId },
        });
        workingCustomerId = requestedCustomerId;
      }
    }
    if (willMutateCustomer) {
      workingCustomerId = await isolateBookingCustomer(id, workingCustomerId);
    }

    if (customerPatch && !replacePrimaryGuest) {
      const customerUpdate: Record<string, unknown> = {};
      if (customerPatch.name !== undefined) customerUpdate.name = String(customerPatch.name).trim();
      if (customerPatch.phone !== undefined) customerUpdate.phone = String(customerPatch.phone).trim();
      if (customerPatch.email !== undefined) {
        const emailValue = customerPatch.email ? String(customerPatch.email).trim() : null;
        const emailError = getEmailValidationError(emailValue, true);
        if (emailError) return errorResponse(emailError);
        customerUpdate.email = emailValue;
      }
      if (customerPatch.address !== undefined) {
        customerUpdate.address = customerPatch.address ? String(customerPatch.address).trim() : null;
      }
      if (customerPatch.idType !== undefined) customerUpdate.idType = customerPatch.idType;
      if (customerPatch.idNumber !== undefined) {
        customerUpdate.idNumber = customerPatch.idNumber
          ? String(customerPatch.idNumber).trim()
          : null;
      }
      if (customerPatch.visaExpiryDate !== undefined) {
        customerUpdate.visaExpiryDate = customerPatch.visaExpiryDate
          ? String(customerPatch.visaExpiryDate).trim()
          : null;
      }
      if (customerPatch.idDocPath !== undefined) {
        customerUpdate.idDocPath = customerPatch.idDocPath ?? null;
      }
      if (customerPatch.registrationNumber !== undefined) {
        customerUpdate.registrationNumber = customerPatch.registrationNumber
          ? String(customerPatch.registrationNumber).trim()
          : null;
      }
      if (customerPatch.nationality !== undefined) {
        customerUpdate.nationality = customerPatch.nationality
          ? String(customerPatch.nationality).trim()
          : null;
      }
      if (customerPatch.company !== undefined) {
        customerUpdate.company = customerPatch.company
          ? String(customerPatch.company).trim()
          : null;
      }
      if (customerPatch.designation !== undefined) {
        customerUpdate.designation = customerPatch.designation
          ? String(customerPatch.designation).trim()
          : null;
      }

      if (Object.keys(customerUpdate).length > 0) {
        await db.customer.update({
          where: { id: workingCustomerId },
          data: customerUpdate,
        });
      }
    }

    if (Array.isArray(body.idDocumentPaths)) {
      await replaceIdDocumentsForBooking(id, body.idDocumentPaths);
      const firstPath = body.idDocumentPaths.find(
        (p: unknown) => typeof p === 'string' && p.startsWith('/uploads/id-docs/')
      );
      if (firstPath) {
        await db.customer.update({
          where: { id: workingCustomerId },
          data: { idDocPath: firstPath },
        });
      }
    }

    const idDocCount = Array.isArray(body.idDocumentPaths)
      ? body.idDocumentPaths.length
      : existing.idDocuments.length;

    const resolvedNidPhysicallyReceived =
      body.nidPhysicallyReceived !== undefined
        ? body.nidPhysicallyReceived !== false
        : existing.nidPhysicallyReceived;

    if (body.isInitialReservation === false) {
      const isCorporate =
        body.isCorporateGuest === true || existing.isCorporateGuest === true;

      if (isCorporate) {
        const refreshedCustomer = await db.customer.findUnique({
          where: { id: workingCustomerId },
        });
        if (!refreshedCustomer) {
          return notFoundResponse('Customer');
        }
        const corporateMissing = getCorporateGuestMissingFields({
          guestName: refreshedCustomer.name,
          guestCompany: refreshedCustomer.company ?? '',
          guestPhone: refreshedCustomer.phone,
          guestDesignation: refreshedCustomer.designation ?? '',
          guestAddress: refreshedCustomer.address ?? '',
        });
        if (corporateMissing.length > 0) {
          return errorResponse(
            `Complete the reservation — required: ${corporateMissing.join(', ')}`
          );
        }
      } else {
      const email =
        customerPatch?.email !== undefined
          ? String(customerPatch.email || '').trim()
          : existing.customer.email?.trim() || '';
      const address =
        customerPatch?.address !== undefined
          ? String(customerPatch.address || '').trim()
          : existing.customer.address?.trim() || '';
      const idNumber =
        customerPatch?.idNumber !== undefined
          ? String(customerPatch.idNumber || '').trim()
          : existing.customer.idNumber?.trim() || '';
      const idType =
        customerPatch?.idType !== undefined
          ? String(customerPatch.idType || '').trim()
          : existing.customer.idType?.trim() || '';
      const nationality =
        customerPatch?.nationality !== undefined
          ? String(customerPatch.nationality || '').trim()
          : existing.customer.nationality?.trim() || '';

      const missing = getCompleteReservationMissingFields({
        nationality,
        idNumber,
        idType,
        email,
        address,
        idDocumentCount: idDocCount,
        nidPhysicallyReceived: resolvedNidPhysicallyReceived,
        hasCompanySelected: hasBookingCompany({
          company:
            body.company !== undefined
              ? formatGuestCompany(body.company)
              : existing.company,
          companyLedgerId:
            body.companyLedgerId !== undefined
              ? typeof body.companyLedgerId === 'string'
                ? body.companyLedgerId.trim() || null
                : null
              : existing.companyLedgerId,
        }),
      });
      if (missing.length > 0) {
        return errorResponse(
          `Complete the reservation — required: ${missing.join(', ')}`
        );
      }

      await ensureCustomerRegistrationNumber(workingCustomerId);
      }
    }

    if (body.isCorporateGuest !== undefined) {
      updateData.isCorporateGuest = body.isCorporateGuest === true;
    }

    if (body.nidPhysicallyReceived !== undefined) {
      updateData.nidPhysicallyReceived = body.nidPhysicallyReceived !== false;
    }

    const resolvedAdults =
      body.adults !== undefined
        ? Math.max(1, parseInt(String(body.adults), 10) || 1)
        : existing.adults;
    const resolvedChildren =
      body.children !== undefined
        ? Math.max(0, parseInt(String(body.children), 10) || 0)
        : existing.children;

    const corporateBooking =
      body.isCorporateGuest === true || existing.isCorporateGuest === true;

    if (body.companions !== undefined && corporateBooking) {
      const companionError = validateCorporateCompanionInputs(
        resolvedAdults,
        ((body.companions as CompanionInput[]) ?? []).map((c) => ({
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

    if (body.companions !== undefined && !corporateBooking) {
      const resolvedNid =
        body.nidPhysicallyReceived !== undefined
          ? body.nidPhysicallyReceived !== false
          : existing.nidPhysicallyReceived !== false
      const companionError = validateCompanionInputs(
        resolvedAdults,
        resolvedChildren,
        (body.companions as CompanionInput[]) ?? [],
        {
          requireIdFields:
            resolvedNid ||
            !hasBookingCompany({
              company:
                body.company !== undefined
                  ? formatGuestCompany(body.company)
                  : existing.company,
              companyLedgerId:
                body.companyLedgerId !== undefined
                  ? typeof body.companyLedgerId === 'string'
                    ? body.companyLedgerId.trim() || null
                    : null
                  : existing.companyLedgerId,
            }),
        }
      );
      if (companionError) {
        return errorResponse(companionError);
      }
    }

    const oldRoomId = existing.roomId;
    const newRoomId = (updateData.roomId as string) || existing.roomId;

    if (
      updateData.companyLedgerId &&
      typeof updateData.companyLedgerId === 'string'
    ) {
      const customerForLedger = await db.customer.findUnique({
        where: { id: workingCustomerId },
      });
      if (customerForLedger) {
        await ensureBookingRegistrationNumber(id);
        const regBooking = await db.booking.findUnique({
          where: { id },
          select: { registrationNumber: true },
        });
        updateData.companyLedgerGuestId = await ensureCompanyLedgerGuestFromCustomer(
          db,
          updateData.companyLedgerId,
          {
            name: customerForLedger.name,
            phone: customerForLedger.phone,
            email: customerForLedger.email,
            nationality: customerForLedger.nationality,
            registrationNumber: regBooking?.registrationNumber,
            address: customerForLedger.address,
            idType: customerForLedger.idType,
            idNumber: customerForLedger.idNumber,
          },
          existing.companyLedgerGuestId
        );
      }
    }

    const booking = await db.booking.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        room: { include: { type: true } },
        idDocuments: { orderBy: { sortOrder: 'asc' } },
        companions: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (newRoomId !== oldRoomId) {
      if (existing.status === 'CHECKED_IN') {
        await db.room.update({ where: { id: oldRoomId }, data: { status: 'CLEANING' } });
        await db.room.update({ where: { id: newRoomId }, data: { status: 'OCCUPIED' } });
      } else {
        await db.room.update({ where: { id: oldRoomId }, data: { status: 'AVAILABLE' } });
        const businessDate = await readCurrentBusinessDateString();
        const checkInForRoom = (updateData.checkIn as Date) ?? existing.checkIn;
        if (isArrivalOnOrBeforeBusinessDate(checkInForRoom, businessDate)) {
          await db.room.update({ where: { id: newRoomId }, data: { status: 'RESERVED' } });
        }
      }
    }

    if (body.companions !== undefined) {
      await replaceBookingCompanions(
        db,
        id,
        (body.companions as CompanionInput[]) ?? []
      );
    }

    // Attaching a ledger to an existing stay has to reach the ledger straight away,
    // the way a converted reservation entry does. Re-posting is safe: the bill is
    // keyed on the booking and checkout later refreshes it with final amounts.
    if (booking.companyLedgerId) {
      const forLedger = await db.booking.findUnique({
        where: { id },
        include: {
          payments: true,
          charges: true,
          restaurantOrders: {
            include: { companyLedgerBill: { select: { id: true } } },
          },
          invoices: true,
        },
      });
      if (forLedger) {
        const latestInvoice =
          forLedger.invoices
            ?.filter((invoice) => invoice.status !== 'CANCELLED')
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
        const roomTotals = computeBookingRoomDue(forLedger, forLedger.payments);
        const totalAmount =
          roomTotals.totalWithVat +
          sumBookingPostedExtras(forLedger.charges, forLedger.payments) +
          sumBookingFolioRestaurant(forLedger.restaurantOrders);
        const dueAmount = resolveBookingDisplayDue(
          forLedger,
          forLedger.payments,
          latestInvoice
        );
        await postCompanyLedgerBill(db, {
          companyLedgerId: booking.companyLedgerId,
          bookingId: id,
          invoiceId: null,
          guestName: booking.customer.name,
          roomNumber: booking.room.roomNumber,
          totalAmount,
          paidAmount: Math.max(0, totalAmount - dueAmount),
          dueAmount,
          notes: booking.notes,
        });
      }
    }

    const bookingWithCompanions =
      body.companions !== undefined
        ? await db.booking.findUnique({
            where: { id },
            include: {
              customer: true,
              room: { include: { type: true } },
              idDocuments: { orderBy: { sortOrder: 'asc' } },
              companions: { orderBy: { sortOrder: 'asc' } },
            },
          })
        : booking;

    await logActivity(
      authResult.id,
      'UPDATE_BOOKING',
      'hotel',
      JSON.stringify({ bookingId: id, changes: updateData })
    );

    return successResponse(bookingWithCompanions, 'Booking updated successfully');
  } catch (error) {
    console.error('Booking update error:', error);
    return errorResponse('Failed to update booking', 500);
  }
}
