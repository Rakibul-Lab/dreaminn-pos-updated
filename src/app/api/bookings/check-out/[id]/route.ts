import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity, generateInvoiceNumber } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';
import {
  parsePaymentMethod,
  paymentRequiresLastFour,
  paymentRequiresReference,
  isValidPaymentAccountLastFour,
} from '@/lib/payment-method';
import { getRoomNightlyTotal } from '@/lib/room-pricing';
import { sumCheckoutBookingPaid } from '@/lib/booking-totals';
import {
  computeCheckoutSettlement,
} from '@/lib/checkout-settlement';
import { buildInvoiceLineItems, replaceInvoiceLineItems } from '@/lib/invoice-line-items';
import {
  buildCheckoutInvoiceLineItems,
  completeOutboundBillTransfer,
  loadBillTransferTargets,
  loadInboundBillTransfers,
  mergeCreditTransferSettlements,
  parseCreditTransferBookingIds,
  prepareCreditTransfers,
} from '@/lib/room-credit-transfer';
import { postCompanyLedgerBill, ensureCompanyLedgerGuestFromCustomer, resolveCompanyLedgerBooking } from '@/lib/company-ledger-billing';
import { DEFAULT_GUEST_COMPANY } from '@/lib/reservation-terms';
import { processAllOverdueStayExtensions, extendOverdueCheckedInBooking } from '@/lib/auto-stay-extension';
import { resolveCheckoutDiscount } from '@/lib/checkout-discount';

async function loadCheckoutBooking(id: string) {
  return db.booking.findUnique({
    where: { id },
    include: {
      room: { include: { type: true } },
      customer: true,
      charges: true,
      companyLedger: { select: { id: true, name: true } },
    },
  });
}

function companyLedgerCheckoutFields(booking: {
  companyLedgerId?: string | null;
  companyLedger?: { id: string; name: string } | null;
}) {
  const billToCompanyLedger = !!booking.companyLedgerId;
  return {
    companyLedgerId: booking.companyLedgerId ?? null,
    companyLedgerName: booking.companyLedger?.name ?? null,
    billToCompanyLedger,
  };
}

async function resolveCheckoutCompanyLedgerFields(
  booking: {
    companyLedgerId?: string | null;
    companyLedger?: { id: string; name: string } | null;
  },
  companyLedgerIdOverride: string | null | undefined
) {
  if (companyLedgerIdOverride === undefined) {
    return companyLedgerCheckoutFields(booking);
  }
  if (!companyLedgerIdOverride) {
    return {
      companyLedgerId: null,
      companyLedgerName: null,
      billToCompanyLedger: false,
    };
  }
  if (companyLedgerIdOverride === booking.companyLedgerId) {
    return companyLedgerCheckoutFields(booking);
  }
  const ledger = await db.companyLedger.findFirst({
    where: { id: companyLedgerIdOverride, active: true },
    select: { id: true, name: true },
  });
  if (!ledger) {
    return {
      companyLedgerId: null,
      companyLedgerName: null,
      billToCompanyLedger: false,
    };
  }
  return {
    companyLedgerId: ledger.id,
    companyLedgerName: ledger.name,
    billToCompanyLedger: true,
  };
}

async function applyCheckoutCompanyLedgerChoice(
  bookingId: string,
  booking: NonNullable<Awaited<ReturnType<typeof loadCheckoutBooking>>>,
  companyLedgerId: string | null
) {
  if (companyLedgerId) {
    const ledgerResult = await resolveCompanyLedgerBooking(db, companyLedgerId, null);
    if ('error' in ledgerResult) {
      return { error: ledgerResult.error };
    }
    const companyLedgerGuestId = await ensureCompanyLedgerGuestFromCustomer(
      db,
      ledgerResult.companyLedgerId,
      {
        name: booking.customer.name,
        phone: booking.customer.phone,
        email: booking.customer.email,
        nationality: booking.customer.nationality,
        idNumber: booking.customer.idNumber,
        idType: booking.customer.idType,
      }
    );
    await db.booking.update({
      where: { id: bookingId },
      data: {
        companyLedgerId: ledgerResult.companyLedgerId,
        companyLedgerGuestId,
        company: ledgerResult.companyName,
      },
    });
    return { ok: true as const };
  }

  await db.booking.update({
    where: { id: bookingId },
    data: {
      companyLedgerId: null,
      companyLedgerGuestId: null,
      company: DEFAULT_GUEST_COMPANY,
    },
  });
  return { ok: true as const };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const chargeableNightsParam = searchParams.get('chargeableNights');
    const chargeableNights =
      chargeableNightsParam != null ? parseInt(chargeableNightsParam, 10) : null;
    const stayAdjustmentMode =
      searchParams.get('stayMode') === 'extend' ? ('extend' as const) : ('shrink' as const);
    const includeExtraCharges = searchParams.get('includeExtraCharges') === 'true';
    const lateCheckoutAmount = includeExtraCharges
      ? Math.max(0, Number(searchParams.get('lateCheckoutAmount') || 0))
      : 0;
    const includeDamageCharge = searchParams.get('includeDamageCharge') === 'true';
    const damageChargeAmount = includeDamageCharge
      ? Math.max(0, Number(searchParams.get('damageChargeAmount') || 0))
      : 0;
    const includeDiscount = searchParams.get('includeDiscount') === 'true';
    const discountType = searchParams.get('discountType') === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    const discountValue = includeDiscount
      ? Math.max(0, Number(searchParams.get('discountValue') || 0))
      : 0;
    const roomCreditTransferEnabled = searchParams.get('roomCreditTransferEnabled') === 'true';
    const creditTransferBookingIds = roomCreditTransferEnabled
      ? parseCreditTransferBookingIds(searchParams.get('creditTransferBookingIds'))
      : [];
    const roomChargeParam = searchParams.get('roomCharge');
    const roomChargeOverride =
      roomChargeParam != null && roomChargeParam !== ''
        ? Math.max(0, Number(roomChargeParam))
        : null;
    const companyLedgerIdParam = searchParams.has('companyLedgerId')
      ? searchParams.get('companyLedgerId')?.trim() || null
      : undefined;

    let booking = await loadCheckoutBooking(id);
    if (!booking) return notFoundResponse('Booking');
    if (booking.status !== 'CHECKED_IN') {
      return errorResponse('Only checked-in bookings can be checked out');
    }

    await extendOverdueCheckedInBooking(db, id);
    booking = await loadCheckoutBooking(id);
    if (!booking) return notFoundResponse('Booking');

    const now = new Date();
    const restaurantOrders = await db.restaurantOrder.findMany({
      where: { bookingId: id, status: { not: 'CANCELLED' } },
      include: {
        payments: { select: { amount: true, paymentType: true } },
      },
    });
    const bookingPayments = await db.payment.findMany({
      where: { bookingId: id },
      select: { amount: true, paymentType: true },
    });

    const checkoutDiscount = resolveCheckoutDiscount(booking, {
      enabled: includeDiscount,
      type: discountType,
      value: discountValue,
    });

    const primarySettlement = computeCheckoutSettlement({
      booking,
      nightlyRate: getRoomNightlyTotal(booking.room),
      restaurantOrders,
      lateCheckoutCharge: 0,
      payments: bookingPayments,
      discountEnabled: checkoutDiscount.discountEnabled,
      discountType: checkoutDiscount.discountType,
      discountValue: checkoutDiscount.discountValue,
      includeExtraCharges,
      damageChargeAmount,
      lateCheckoutAmount,
      roomChargeOverride:
        roomChargeOverride != null && !Number.isNaN(roomChargeOverride)
          ? roomChargeOverride
          : null,
      asOf: now,
    });

    if (roomCreditTransferEnabled && creditTransferBookingIds.length > 0) {
      const { targets, error } = await loadBillTransferTargets(
        db,
        id,
        creditTransferBookingIds,
        !!booking.billTransferredToBookingId
      );
      if (error) return errorResponse(error);
      const target = targets[0];
      const ledgerFields = await resolveCheckoutCompanyLedgerFields(
        booking,
        companyLedgerIdParam
      );
      return successResponse({
        bookingId: id,
        customerName: booking.customer.name,
        roomNumber: booking.room.roomNumber,
        roomTypeName: booking.room.type.name,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        actualCheckIn: booking.actualCheckIn,
        checkoutAt: now,
        ...primarySettlement,
        billTransferOut: true,
        billTransferTarget: {
          bookingId: target.id,
          roomNumber: target.room.roomNumber,
          roomTypeName: target.room.type.name,
          customerName: target.customer.name,
        },
        transferAmount: primarySettlement.dueBeforeSettlement,
        dueBeforeSettlement: 0,
        creditAmount: 0,
        ...ledgerFields,
      });
    }

    const inboundSources = await loadInboundBillTransfers(db, id);
    const inboundTransfers = await prepareCreditTransfers(db, inboundSources, now);
    const hasInboundTransfers = inboundTransfers.length > 0;

    const settlement = hasInboundTransfers
      ? mergeCreditTransferSettlements(primarySettlement, inboundTransfers, {
          payingBooking: booking,
          discountEnabled: checkoutDiscount.discountEnabled,
          discountType: checkoutDiscount.discountType,
          discountValue: checkoutDiscount.discountValue,
          primaryPayments: bookingPayments,
        })
      : primarySettlement;

    const ledgerFields = await resolveCheckoutCompanyLedgerFields(
      booking,
      companyLedgerIdParam
    );

    return successResponse({
      bookingId: id,
      customerName: booking.customer.name,
      roomNumber: booking.room.roomNumber,
      roomTypeName: booking.room.type.name,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      actualCheckIn: booking.actualCheckIn,
      checkoutAt: now,
      reservationDiscountLocked: checkoutDiscount.reservationDiscountLocked,
      ...settlement,
      ...ledgerFields,
    });
  } catch (error) {
    console.error('Check-out preview error:', error);
    return errorResponse('Failed to load check-out preview', 500);
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
    if (!authUser || !authUser.active) {
      return errorResponse('Session expired. Please log out and log in again.', 401);
    }

    const { id } = await params;
    const body = await request.json();
    const finalPayment = Number(body?.finalPayment || 0);
    const paymentMethod = parsePaymentMethod(body?.paymentMethod, 'CASH');
    const paymentReference = body?.paymentReference
      ? String(body.paymentReference).trim()
      : null;
    const paymentAccountLastFour = body?.paymentAccountLastFour
      ? String(body.paymentAccountLastFour).trim()
      : null;
    const paymentNotes = body?.paymentNotes || null;
    const includeExtraCharges = body?.includeExtraCharges === true;
    const lateCheckoutAmount = includeExtraCharges
      ? Math.max(0, Number(body?.lateCheckoutAmount || 0))
      : 0;
    const includeDamageCharge = body?.includeDamageCharge === true;
    const damageChargeAmount = includeDamageCharge
      ? Math.max(0, Number(body?.damageChargeAmount || 0))
      : 0;
    const includeDiscount = body?.includeDiscount === true;
    const discountType = body?.discountType === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    const discountValue = includeDiscount
      ? Math.max(0, Number(body?.discountValue || 0))
      : 0;
    const roomCreditTransferEnabled = body?.roomCreditTransferEnabled === true;
    const creditTransferBookingIds = roomCreditTransferEnabled
      ? parseCreditTransferBookingIds(body?.creditTransferBookingIds)
      : [];
    const roomChargeOverride =
      body?.roomCharge != null && body?.roomCharge !== ''
        ? Math.max(0, Number(body.roomCharge))
        : null;

    let booking = await loadCheckoutBooking(id);
    if (!booking) return notFoundResponse('Booking');
    if (booking.status !== 'CHECKED_IN') {
      return errorResponse('Only checked-in bookings can be checked out');
    }

    await extendOverdueCheckedInBooking(db, id);
    booking = await loadCheckoutBooking(id);
    if (!booking) return notFoundResponse('Booking');

    if (
      roomChargeOverride != null &&
      !Number.isNaN(roomChargeOverride) &&
      roomChargeOverride >= 0
    ) {
      await db.booking.update({
        where: { id },
        data: { totalRoomCharge: roomChargeOverride },
      });
      booking = { ...booking, totalRoomCharge: roomChargeOverride };
    }

    const checkoutDiscount = resolveCheckoutDiscount(booking, {
      enabled: includeDiscount,
      type: discountType,
      value: discountValue,
    });

    if (!checkoutDiscount.reservationDiscountLocked) {
      await db.booking.update({
        where: { id },
        data: {
          discountEnabled: checkoutDiscount.discountEnabled,
          discountType: checkoutDiscount.discountEnabled ? checkoutDiscount.discountType : null,
          discountValue: checkoutDiscount.discountEnabled ? checkoutDiscount.discountValue : 0,
        },
      });
      booking = {
        ...booking,
        discountEnabled: checkoutDiscount.discountEnabled,
        discountType: checkoutDiscount.discountEnabled ? checkoutDiscount.discountType : null,
        discountValue: checkoutDiscount.discountEnabled ? checkoutDiscount.discountValue : 0,
      };
    }

    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'companyLedgerId')) {
      const rawLedgerId =
        typeof body.companyLedgerId === 'string' ? body.companyLedgerId.trim() : '';
      const applyResult = await applyCheckoutCompanyLedgerChoice(
        id,
        booking,
        rawLedgerId || null
      );
      if ('error' in applyResult) {
        return errorResponse(applyResult.error);
      }
      booking = await loadCheckoutBooking(id);
      if (!booking) return notFoundResponse('Booking');
    }

    const now = new Date();

    if (!includeExtraCharges) {
      await db.roomCharge.deleteMany({
        where: { bookingId: id, chargeType: 'LATE_CHECKOUT' },
      });
      booking.charges = booking.charges.filter((c) => c.chargeType !== 'LATE_CHECKOUT');
    } else if (lateCheckoutAmount > 0) {
      const existingLate = booking.charges.find((c) => c.chargeType === 'LATE_CHECKOUT');
      if (existingLate) {
        await db.roomCharge.update({
          where: { id: existingLate.id },
          data: {
            amount: lateCheckoutAmount,
            description: 'Late checkout charge',
          },
        });
      } else {
        await db.roomCharge.create({
          data: {
            bookingId: id,
            chargeType: 'LATE_CHECKOUT',
            description: 'Late checkout charge',
            amount: lateCheckoutAmount,
            quantity: 1,
            chargeDate: now,
          },
        });
      }
      booking.charges = await db.roomCharge.findMany({ where: { bookingId: id } });
    } else {
      await db.roomCharge.deleteMany({
        where: { bookingId: id, chargeType: 'LATE_CHECKOUT' },
      });
      booking.charges = booking.charges.filter((c) => c.chargeType !== 'LATE_CHECKOUT');
    }

    if (!includeDamageCharge) {
      await db.roomCharge.deleteMany({
        where: { bookingId: id, chargeType: 'DAMAGE' },
      });
      booking.charges = await db.roomCharge.findMany({ where: { bookingId: id } });
    } else if (damageChargeAmount > 0) {
      const existingDamage = booking.charges.find((c) => c.chargeType === 'DAMAGE');
      if (existingDamage) {
        await db.roomCharge.update({
          where: { id: existingDamage.id },
          data: { amount: damageChargeAmount, description: 'Damage charges' },
        });
      } else {
        await db.roomCharge.create({
          data: {
            bookingId: id,
            chargeType: 'DAMAGE',
            description: 'Damage charges',
            amount: damageChargeAmount,
            quantity: 1,
            chargeDate: now,
          },
        });
      }
      booking.charges = await db.roomCharge.findMany({ where: { bookingId: id } });
    }

    const restaurantOrders = await db.restaurantOrder.findMany({
      where: { bookingId: id, status: { not: 'CANCELLED' } },
      include: {
        payments: { select: { amount: true, paymentType: true } },
      },
    });
    let bookingPayments = await db.payment.findMany({
      where: { bookingId: id },
      select: { amount: true, paymentType: true },
    });

    const primarySettlement = computeCheckoutSettlement({
      booking,
      nightlyRate: getRoomNightlyTotal(booking.room),
      restaurantOrders,
      lateCheckoutCharge: 0,
      payments: bookingPayments,
      discountEnabled: checkoutDiscount.discountEnabled,
      discountType: checkoutDiscount.discountType,
      discountValue: checkoutDiscount.discountValue,
      includeExtraCharges,
      damageChargeAmount: includeDamageCharge ? damageChargeAmount : 0,
      lateCheckoutAmount,
      roomChargeOverride:
        roomChargeOverride != null && !Number.isNaN(roomChargeOverride)
          ? roomChargeOverride
          : null,
      asOf: now,
    });

    if (roomCreditTransferEnabled && creditTransferBookingIds.length > 0) {
      const { targets, error } = await loadBillTransferTargets(
        db,
        id,
        creditTransferBookingIds,
        !!booking.billTransferredToBookingId
      );
      if (error) return errorResponse(error);
      const target = targets[0];

      await completeOutboundBillTransfer(
        db,
        booking as Parameters<typeof completeOutboundBillTransfer>[1],
        target.id,
        target.room.roomNumber,
        now
      );

      await logActivity(
        authUser.id,
        'CHECK_OUT',
        'hotel',
        JSON.stringify({
          bookingId: id,
          roomId: booking.roomId,
          customerName: booking.customer.name,
          billTransferOut: true,
          billTransferTargetBookingId: target.id,
          billTransferTargetRoomNumber: target.room.roomNumber,
          transferAmount: primarySettlement.dueBeforeSettlement,
        })
      );

      return successResponse(
        {
          billTransferOut: true,
          targetRoomNumber: target.room.roomNumber,
          transferAmount: primarySettlement.dueBeforeSettlement,
        },
        `Room ${booking.room.roomNumber} checked out. Bill transferred to Room ${target.room.roomNumber}.`
      );
    }

    const inboundSources = await loadInboundBillTransfers(db, id);
    const inboundTransfers = await prepareCreditTransfers(db, inboundSources, now);
    const hasInboundTransfers = inboundTransfers.length > 0;

    const settlement = hasInboundTransfers
      ? mergeCreditTransferSettlements(primarySettlement, inboundTransfers, {
          payingBooking: booking,
          discountEnabled: checkoutDiscount.discountEnabled,
          discountType: checkoutDiscount.discountType,
          discountValue: checkoutDiscount.discountValue,
          primaryPayments: bookingPayments,
        })
      : primarySettlement;

    const {
      roomCharges,
      foodCharges,
      extraCharges,
      subtotal,
      discount,
      vatAmount,
      totalAmount,
      totalPaid: totalPaidBeforeFinal,
      dueBeforeSettlement: finalDueAmount,
      creditAmount,
      chargeableNights: settledNights,
      nightlyRate,
      hotelVat,
      restaurantVat,
      vatApplied,
      vatPercent,
    } = settlement;

    const isCompanyLedgerCheckout = !!booking.companyLedgerId;

    type CheckoutPaymentRow = {
      amount?: unknown
      method?: string
      reference?: string
      accountLastFour?: string
      notes?: string
    };

    const checkoutPaymentRows: CheckoutPaymentRow[] = Array.isArray(body?.checkoutPayments)
      ? body.checkoutPayments
      : finalPayment > 0
        ? [
            {
              amount: finalPayment,
              method: paymentMethod,
              reference: paymentReference ?? undefined,
              accountLastFour: paymentAccountLastFour ?? undefined,
              notes: paymentNotes ?? undefined,
            },
          ]
        : [];

    let totalFinalPayment = 0;
    for (const row of checkoutPaymentRows) {
      const amount = Math.max(0, Number(row.amount || 0));
      if (amount <= 0) continue;
      const method = parsePaymentMethod(row.method, 'CASH');
      const reference = row.reference ? String(row.reference).trim() : null;
      const accountLastFour = row.accountLastFour ? String(row.accountLastFour).trim() : null;
      const notes = row.notes ? String(row.notes).trim() : 'Final payment at check-out';

      if (paymentRequiresReference(method) && !reference) {
        return errorResponse('Payment reference is required for this payment method');
      }
      if (
        paymentRequiresLastFour(method) &&
        (!accountLastFour || !isValidPaymentAccountLastFour(accountLastFour))
      ) {
        return errorResponse('Last 4 digits are required for card / bKash / Nagad / Upay');
      }

      totalFinalPayment += amount;
    }

    if (totalFinalPayment > finalDueAmount + 0.01) {
      return errorResponse(
        `Payment cannot exceed due amount. Maximum: ৳${finalDueAmount.toFixed(2)}`
      );
    }

    if (
      !isCompanyLedgerCheckout &&
      finalDueAmount > 0.01 &&
      totalFinalPayment + 0.01 < finalDueAmount
    ) {
      return errorResponse(
        `Due amount must be fully cleared to checkout. Required: ৳${finalDueAmount.toFixed(2)}`
      );
    }

    for (const row of checkoutPaymentRows) {
      const amount = Math.max(0, Number(row.amount || 0));
      if (amount <= 0) continue;
      const method = parsePaymentMethod(row.method, 'CASH');
      const reference = row.reference ? String(row.reference).trim() : null;
      const accountLastFour = row.accountLastFour ? String(row.accountLastFour).trim() : null;
      const notes = row.notes ? String(row.notes).trim() : 'Final payment at check-out';

      await db.payment.create({
        data: {
          amount,
          method,
          paymentType: 'FINAL',
          bookingId: id,
          receivedBy: authUser.id,
          reference: paymentRequiresReference(method) ? reference : null,
          accountLastFour: paymentRequiresLastFour(method) ? accountLastFour : null,
          notes,
        },
      });
    }

    if (totalFinalPayment > 0) {
      bookingPayments = await db.payment.findMany({
        where: { bookingId: id },
        select: { amount: true, paymentType: true },
      });
    }

    const totalPaidAfter = sumCheckoutBookingPaid(bookingPayments);
    const invoiceDue = Math.max(0, totalAmount - totalPaidAfter);
    const guestDueAmount = isCompanyLedgerCheckout ? 0 : invoiceDue;

    const updatedBooking = await db.booking.update({
      where: { id },
      data: {
        status: 'CHECKED_OUT',
        actualCheckOut: now,
        totalRoomCharge: roomCharges,
        dueAmount: guestDueAmount,
      },
      include: {
        customer: true,
        room: { include: { type: true } },
        charges: true,
        payments: true,
        restaurantOrders: true,
        invoices: true,
      },
    });

    await db.room.update({
      where: { id: booking.roomId },
      data: { status: 'CLEANING' },
    });

    await db.housekeepingTask.create({
      data: {
        roomId: booking.roomId,
        taskType: 'cleaning',
        status: 'PENDING',
        notes: `Post-checkout cleaning for room ${booking.room.roomNumber}`,
      },
    });

    const existingInvoice = await db.invoice.findFirst({
      where: { bookingId: id, status: { not: 'CANCELLED' } },
    });

    const restaurantOrdersWithItems = await db.restaurantOrder.findMany({
      where: { bookingId: id, status: { not: 'CANCELLED' } },
      include: {
        payments: { select: { amount: true, paymentType: true } },
        items: {
          include: { menuItem: { select: { name: true } } },
        },
      },
    });

    const lineItems = hasInboundTransfers
      ? buildCheckoutInvoiceLineItems(
          {
            roomNumber: updatedBooking.room.roomNumber,
            roomTypeName: updatedBooking.room.type.name,
            checkIn: updatedBooking.checkIn,
            checkOut: updatedBooking.checkOut,
            charges: updatedBooking.charges,
            restaurantOrders: restaurantOrdersWithItems,
            roomCharges: primarySettlement.roomCharges,
            chargeableNights: primarySettlement.chargeableNights,
            nightlyRate: primarySettlement.nightlyRate,
            stayAdjusted: primarySettlement.stayAdjusted,
            includeExtraCharges,
          },
          inboundTransfers,
          discount,
          hotelVat,
          vatPercent,
          vatApplied
        )
      : buildInvoiceLineItems({
          roomNumber: updatedBooking.room.roomNumber,
          roomTypeName: updatedBooking.room.type.name,
          checkIn: updatedBooking.checkIn,
          checkOut: updatedBooking.checkOut,
          charges: updatedBooking.charges,
          restaurantOrders: restaurantOrdersWithItems,
          roomCharges,
          chargeableNights: settledNights,
          nightlyRate,
          stayAdjusted: settlement.stayAdjusted,
          includeExtraCharges,
          discount,
          hotelVat,
          hotelVatPercent: vatPercent,
          vatApplied,
          restaurantVat,
        });

    const paidAmount = totalPaidAfter;
    const invoiceStatus = invoiceDue <= 0 ? 'PAID' : 'ISSUED';
    const companyLedgerDue = isCompanyLedgerCheckout ? invoiceDue : 0;

    const invoicePayload = {
      roomCharges,
      foodCharges,
      extraCharges,
      subtotal,
      discount,
      vatAmount,
      totalAmount,
      paidAmount,
      dueAmount: invoiceDue,
      status: invoiceStatus,
      issuedAt: now,
      paidAt: invoiceStatus === 'PAID' ? now : null,
    };

    let generatedInvoiceId: string | null = null;
    await db.$transaction(async (tx) => {
      if (existingInvoice) {
        await tx.invoice.update({
          where: { id: existingInvoice.id },
          data: invoicePayload,
        });
        await replaceInvoiceLineItems(tx, existingInvoice.id, lineItems);
        generatedInvoiceId = existingInvoice.id;
      } else {
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber: generateInvoiceNumber(),
            bookingId: id,
            ...invoicePayload,
          },
        });
        await replaceInvoiceLineItems(tx, invoice.id, lineItems);
        generatedInvoiceId = invoice.id;
      }

      if (generatedInvoiceId) {
        await tx.payment.updateMany({
          where: { bookingId: id, invoiceId: null },
          data: { invoiceId: generatedInvoiceId },
        });
      }
    });

    if (isCompanyLedgerCheckout && booking.companyLedgerId) {
      await postCompanyLedgerBill(db, {
        companyLedgerId: booking.companyLedgerId,
        bookingId: id,
        invoiceId: generatedInvoiceId,
        guestName: booking.customer.name,
        roomNumber: booking.room.roomNumber,
        totalAmount,
        paidAmount,
        dueAmount: companyLedgerDue,
        notes:
          companyLedgerDue > 0
            ? `Checkout bill — ৳${companyLedgerDue.toFixed(2)} due on company ledger`
            : 'Checkout bill — fully paid',
      });
    }

    await logActivity(
      authUser.id,
      'CHECK_OUT',
      'hotel',
      JSON.stringify({
        bookingId: id,
        roomId: booking.roomId,
        customerName: booking.customer.name,
        chargeableNights: settledNights,
        bookedNights: settlement.bookedNights,
        actualStayNights: settlement.actualStayNights,
        lateCheckoutCharge: settlement.lateCheckoutCharge,
        damageCharge: settlement.damageCharge,
        roomCharges,
        totalAmount,
        finalPayment: totalFinalPayment,
        finalDueAmount,
        creditAmount,
        invoiceId: generatedInvoiceId,
        companyLedgerId: booking.companyLedgerId,
        companyLedgerDue,
        inboundBillTransferBookingIds: inboundTransfers.map((t) => t.booking.id),
        inboundBillTransferRoomNumbers: inboundTransfers.map((t) => t.booking.room.roomNumber),
      })
    );

    const successMessage = isCompanyLedgerCheckout
      ? companyLedgerDue > 0
        ? `Check-out complete. ৳${companyLedgerDue.toFixed(2)} billed to ${booking.companyLedger?.name ?? 'company ledger'}.`
        : `Check-out complete. Bill recorded on ${booking.companyLedger?.name ?? 'company ledger'}.`
      : creditAmount > 0
        ? `Check-out complete. Guest overpaid by ৳${creditAmount.toFixed(2)} — issue refund if needed.`
        : 'Check-out successful and invoice generated';

    return successResponse(
      {
        booking: updatedBooking,
        invoiceId: generatedInvoiceId,
        creditAmount,
        stayAdjusted: settlement.stayAdjusted,
        companyLedgerDue,
        companyLedgerName: booking.companyLedger?.name ?? null,
      },
      successMessage
    );
  } catch (error) {
    console.error('Check-out error:', error);
    const message = error instanceof Error ? error.message : ''
    if (message.includes('Unique constraint') || message.includes('company_ledger_bills')) {
      return errorResponse(
        'Checkout could not complete — this stay may already be billed. Refresh and check booking status.',
        409
      );
    }
    return errorResponse('Failed to check out', 500);
  }
}
