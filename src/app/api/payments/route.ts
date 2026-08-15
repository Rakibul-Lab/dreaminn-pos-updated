import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessHotel, canAccessRestaurant } from '@/lib/auth';
import { successResponse, errorResponse, paginatedResponse, logActivity } from '@/lib/api-utils';
import {
  computeBookingRoomDue,
  resolveBookingDisplayDue,
  sumBookingNetPaid,
  applyBookingPaymentToStoredDue,
  applyBookingChargeToStoredDue,
} from '@/lib/booking-totals';
import { PaymentType, PaymentMethod, Prisma, type ChargeType } from '@prisma/client';
import {
  resolveActiveBookingInvoiceId,
  syncInvoicePaymentTotals,
  appendManualChargeInvoiceLine,
} from '@/lib/invoice-payments';
import { formatPaymentTypeLabel, isManualRecordPaymentType, parseCustomPaymentTypeValue } from '@/lib/payment-method';
import {
  parsePaymentMethod,
  paymentRequiresLastFour,
  paymentRequiresReference,
  isValidPaymentAccountLastFour,
} from '@/lib/payment-method';
import { stampCurrentBusinessDate } from '@/lib/business-date';
import { parseBookingRestaurantBillNotes } from '@/lib/booking-restaurant-bill-notes';
import { buildPaymentSearchWhere } from '@/lib/payment-search';
import {
  parseFullSlipSearch,
  paymentMatchesSlipSearch,
  utcDayRangeFromYyyyMmDd,
} from '@/lib/booking-payment-slip';

const paymentListInclude = {
  booking: {
    select: {
      id: true,
      confirmationNumber: true,
      registrationNumber: true,
      customer: { select: { id: true, name: true } },
      room: { select: { id: true, roomNumber: true } },
    },
  },
  order: {
    select: {
      id: true,
      orderNumber: true,
      orderType: true,
    },
  },
  receiver: {
    select: { id: true, name: true, role: true },
  },
} satisfies Prisma.PaymentInclude;

/** Folio charges posted from Send to Room, listed next to payments with their own status. */
const roomChargeListInclude = {
  recorder: { select: { id: true, name: true, role: true } },
  booking: {
    select: {
      id: true,
      confirmationNumber: true,
      registrationNumber: true,
      status: true,
      dueAmount: true,
      customer: { select: { id: true, name: true } },
      room: { select: { id: true, roomNumber: true } },
      invoices: {
        where: { status: { not: 'CANCELLED' as const } },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: { dueAmount: true },
      },
    },
  },
} satisfies Prisma.RoomChargeInclude;

/** Restaurant bills posted to a room folio from the booking row action. */
const folioRestaurantListInclude = {
  creator: { select: { id: true, name: true, role: true } },
  booking: {
    select: {
      id: true,
      confirmationNumber: true,
      registrationNumber: true,
      status: true,
      dueAmount: true,
      customer: { select: { id: true, name: true } },
      room: { select: { id: true, roomNumber: true } },
      invoices: {
        where: { status: { not: 'CANCELLED' as const } },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: { dueAmount: true },
      },
    },
  },
} satisfies Prisma.RestaurantOrderInclude;

type FolioRestaurantListRow = Prisma.RestaurantOrderGetPayload<{
  include: typeof folioRestaurantListInclude;
}>;

function mapFolioRestaurantToListRow(order: FolioRestaurantListRow) {
  const booking = order.booking!;
  const invoiceDue = booking.invoices[0]?.dueAmount;
  const outstanding = invoiceDue ?? booking.dueAmount ?? 0;
  const { invoices: _invoices, ...bookingRest } = booking;
  const billNo = parseBookingRestaurantBillNotes(order.notes).billNo;

  return {
    id: order.id,
    recordType: 'room_charge' as const,
    chargeStatus: outstanding <= 0.005 ? ('PAID' as const) : ('SENT_TO_ROOM' as const),
    amount: order.totalAmount,
    method: 'NONE',
    paymentType: 'RESTAURANT',
    categoryLabel: billNo !== '—' ? `Restaurant · Bill ${billNo}` : 'Restaurant',
    bookingId: order.bookingId,
    orderId: null,
    reference: null,
    accountLastFour: null,
    notes: order.notes,
    settlementSource: null,
    createdAt: order.createdAt,
    booking: bookingRest,
    order: null,
    receiver: order.creator,
  };
}

/**
 * Mirrors `buildRoomChargeListWhere` for restaurant bills sitting on a room folio.
 * They are charges rather than money taken, so any filter that only makes sense for
 * a real payment hides them.
 */
function buildFolioRestaurantListWhere(input: {
  role: string;
  bookingId: string | null;
  orderId: string | null;
  paymentType: PaymentType | null;
  customCategoryLabel: string | null;
  method: PaymentMethod | null;
  settlementSource: string | null;
  search: string;
  startDate: string | null;
  endDate: string | null;
}): Prisma.RestaurantOrderWhereInput | null {
  if (input.role === 'RESTAURANT_STAFF') return null;
  if (input.orderId || input.method || input.settlementSource) return null;
  if (input.customCategoryLabel) return null;
  if (input.paymentType && input.paymentType !== 'RESTAURANT') return null;

  const where: Prisma.RestaurantOrderWhereInput = {
    status: { not: 'CANCELLED' },
    billingDisposition: { not: 'PAID_DIRECT' },
    companyLedgerBill: null,
    items: { none: {} },
    notes: { startsWith: 'Bill No.' },
    booking: {
      is: {
        // Check-out settles the bill with a real payment row that carries its own
        // slip, so the placeholder is dropped once that row exists.
        payments: { none: { paymentType: 'FINAL', categoryLabel: { not: null } } },
      },
    },
  };

  if (input.bookingId) where.bookingId = input.bookingId;

  if (!input.search && (input.startDate || input.endDate)) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (input.startDate) {
      const start = new Date(input.startDate);
      if (!Number.isNaN(start.getTime())) {
        start.setHours(0, 0, 0, 0);
        createdAt.gte = start;
      }
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      if (!Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
    }
    if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;
  }

  if (input.search) {
    where.OR = [
      { notes: { contains: input.search } },
      { booking: { registrationNumber: { contains: input.search } } },
      { booking: { confirmationNumber: { contains: input.search } } },
      { booking: { room: { roomNumber: { contains: input.search } } } },
      { booking: { customer: { name: { contains: input.search } } } },
    ];
  }

  return where;
}

const CHARGE_TYPE_BY_PAYMENT_TYPE: Partial<Record<PaymentType, ChargeType>> = {
  EXTRA_CHARGES: 'EXTRA_SERVICE',
  DAMAGE_CHARGES: 'DAMAGE',
  OTHERS: 'OTHER',
};

const PAYMENT_TYPE_BY_CHARGE_TYPE: Partial<Record<ChargeType, PaymentType>> = {
  EXTRA_SERVICE: 'EXTRA_CHARGES',
  DAMAGE: 'DAMAGE_CHARGES',
  OTHER: 'OTHERS',
};

type RoomChargeListRow = Prisma.RoomChargeGetPayload<{ include: typeof roomChargeListInclude }>;

/** Charge is settled once the stay folio it was posted to has no outstanding due. */
function mapRoomChargeToListRow(charge: RoomChargeListRow) {
  const invoiceDue = charge.booking.invoices[0]?.dueAmount;
  const outstanding = invoiceDue ?? charge.booking.dueAmount ?? 0;
  const { invoices: _invoices, ...booking } = charge.booking;

  return {
    id: charge.id,
    recordType: 'room_charge' as const,
    chargeStatus: outstanding <= 0.005 ? ('PAID' as const) : ('SENT_TO_ROOM' as const),
    amount: charge.amount * charge.quantity,
    method: 'NONE',
    paymentType: PAYMENT_TYPE_BY_CHARGE_TYPE[charge.chargeType] ?? 'OTHERS',
    categoryLabel: charge.description || null,
    bookingId: charge.bookingId,
    orderId: null,
    reference: null,
    accountLastFour: null,
    notes: charge.notes,
    settlementSource: null,
    createdAt: charge.createdAt,
    booking,
    order: null,
    receiver: charge.recorder,
  };
}

/**
 * Send to Room charges only belong in the hotel payments list. Any filter that has
 * no meaning for a folio charge (method, restaurant scope, order) hides them so the
 * existing payment filters keep behaving exactly as before.
 */
function buildRoomChargeListWhere(input: {
  role: string;
  bookingId: string | null;
  orderId: string | null;
  paymentType: PaymentType | null;
  customCategoryLabel: string | null;
  method: PaymentMethod | null;
  settlementSource: string | null;
  search: string;
  startDate: string | null;
  endDate: string | null;
}): Prisma.RoomChargeWhereInput | null {
  if (input.role === 'RESTAURANT_STAFF') return null;
  if (input.orderId || input.method || input.settlementSource) return null;
  if (input.paymentType && !CHARGE_TYPE_BY_PAYMENT_TYPE[input.paymentType] && !input.customCategoryLabel) {
    return null;
  }

  // Check-out settles these charges with a real payment row that carries its own
  // slip, so the placeholder is dropped once that row exists.
  const where: Prisma.RoomChargeWhereInput = {
    recordedBy: { not: null },
    booking: {
      payments: { none: { paymentType: 'FINAL', categoryLabel: { not: null } } },
    },
  };

  if (input.bookingId) where.bookingId = input.bookingId;
  if (input.customCategoryLabel) {
    where.description = input.customCategoryLabel;
  } else if (input.paymentType) {
    where.chargeType = CHARGE_TYPE_BY_PAYMENT_TYPE[input.paymentType];
    // Built-in "Others" should not pull in custom-named folio charges.
    if (input.paymentType === 'OTHERS') {
      where.description = formatPaymentTypeLabel('OTHERS');
    }
  }

  if (!input.search && (input.startDate || input.endDate)) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (input.startDate) {
      const start = new Date(input.startDate);
      if (!Number.isNaN(start.getTime())) {
        start.setHours(0, 0, 0, 0);
        createdAt.gte = start;
      }
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      if (!Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
    }
    if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;
  }

  if (input.search) {
    where.OR = [
      { description: { contains: input.search } },
      { notes: { contains: input.search } },
      { booking: { registrationNumber: { contains: input.search } } },
      { booking: { confirmationNumber: { contains: input.search } } },
      { booking: { room: { roomNumber: { contains: input.search } } } },
      { booking: { customer: { name: { contains: input.search } } } },
    ];
  }

  return where;
}

// GET /api/payments - List payments with filters
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const user = authResult;
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const bookingId = searchParams.get('bookingId');
    const orderId = searchParams.get('orderId');
    const paymentTypeRaw = searchParams.get('paymentType');
    const settlementSource = searchParams.get('settlementSource');
    const method = searchParams.get('method') as PaymentMethod | null;
    const startDate = searchParams.get('startDate') || searchParams.get('dateFrom');
    const endDate = searchParams.get('endDate') || searchParams.get('dateTo');
    const search = searchParams.get('search')?.trim() || '';

    const customCategoryId = paymentTypeRaw ? parseCustomPaymentTypeValue(paymentTypeRaw) : null;
    let customCategoryLabel: string | null = null;
    let paymentType: PaymentType | null = null;

    if (customCategoryId) {
      const category = await db.paymentCategory.findFirst({
        where: { id: customCategoryId, active: true },
        select: { name: true },
      });
      customCategoryLabel = category?.name ?? null;
      if (!customCategoryLabel) {
        return paginatedResponse([], 0, page, limit, { sumAmount: 0 });
      }
    } else if (paymentTypeRaw && Object.values(PaymentType).includes(paymentTypeRaw as PaymentType)) {
      paymentType = paymentTypeRaw as PaymentType;
    }

    const skip = (page - 1) * limit;

    // Build where clause with role-based filtering
    const where: Prisma.PaymentWhereInput = {};

    // Role-based access control
    if (user.role === 'HOTEL_STAFF' || user.role === 'HOTEL_FD') {
      // Hotel staff: show booking-linked payments + standalone hotel payments
      where.OR = [
        { bookingId: { not: null } },
        { paymentType: { not: 'RESTAURANT' } },
        { receivedBy: user.id },
      ];
    } else if (user.role === 'RESTAURANT_STAFF') {
      // Restaurant staff: hotel ledger settlements + direct payments on delivered orders
      where.orderId = { not: null };
      where.paymentType = 'RESTAURANT';
      where.settlementSource = { in: ['HOTEL_DUE', 'RESTAURANT_DIRECT'] };
    }
    // ADMIN can see all

    // Apply filters
    if (bookingId) {
      where.bookingId = where.bookingId ? { ...where.bookingId as object, equals: bookingId } : bookingId;
    }
    if (orderId) {
      where.orderId = where.orderId ? { ...where.orderId as object, equals: orderId } : orderId;
    }
    if (customCategoryLabel) {
      where.paymentType = 'OTHERS';
      where.categoryLabel = customCategoryLabel;
    } else if (paymentType) {
      where.paymentType = paymentType;
      // Built-in types exclude user-defined labels stored under OTHERS.
      if (paymentType === 'OTHERS') {
        where.categoryLabel = null;
      }
    }
    if (
      settlementSource &&
      (settlementSource === 'HOTEL_DUE' || settlementSource === 'RESTAURANT_DIRECT')
    ) {
      where.settlementSource = settlementSource;
    }
    if (method) {
      where.method = method;
    }

    // Date range filter (inclusive days) — skipped when searching so old slips are findable
    if (!search && (startDate || endDate)) {
      const createdAt: Record<string, unknown> = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!Number.isNaN(start.getTime())) {
          start.setHours(0, 0, 0, 0);
          createdAt.gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          createdAt.lte = end;
        }
      }
      if (createdAt.gte || createdAt.lte) {
        where.createdAt = createdAt;
      }
    }

    if (search) {
      const fullSlip = parseFullSlipSearch(search);
      const slipDay = fullSlip ? utcDayRangeFromYyyyMmDd(fullSlip.datePart) : null;
      if (fullSlip && slipDay) {
        const candidates = await db.payment.findMany({
          where: {
            ...where,
            createdAt: { gte: slipDay.dateFrom, lte: slipDay.dateTo },
          },
          include: paymentListInclude,
          orderBy: { createdAt: 'desc' },
          take: 2500,
        });
        const filtered = candidates.filter((payment) => paymentMatchesSlipSearch(payment, fullSlip));
        const total = filtered.length;
        const pageRows = filtered.slice(skip, skip + limit);
        const sumAmount = filtered.reduce((sum, payment) => sum + payment.amount, 0);
        return paginatedResponse(pageRows, total, page, limit, { sumAmount });
      }

      const searchWhere = buildPaymentSearchWhere(search);
      if (searchWhere) {
        const existingAnd = where.AND
          ? Array.isArray(where.AND)
            ? where.AND
            : [where.AND]
          : [];
        where.AND = [...existingAnd, searchWhere];
      }
    }

    // Send to Room charges are not money received, so they are listed for status
    // only and never added to the collected total.
    const chargeWhere = buildRoomChargeListWhere({
      role: user.role,
      bookingId,
      orderId,
      paymentType,
      customCategoryLabel,
      method,
      settlementSource,
      search,
      startDate,
      endDate,
    });

    const restaurantWhere = buildFolioRestaurantListWhere({
      role: user.role,
      bookingId,
      orderId,
      paymentType,
      customCategoryLabel,
      method,
      settlementSource,
      search,
      startDate,
      endDate,
    });

    const mergeWindow = skip + limit;

    const [
      payments,
      total,
      sumResult,
      chargeRows,
      chargeTotal,
      restaurantRows,
      restaurantTotal,
    ] = await Promise.all([
      db.payment.findMany({
        where,
        include: paymentListInclude,
        orderBy: { createdAt: 'desc' },
        take: chargeWhere || restaurantWhere ? mergeWindow : limit,
        skip: chargeWhere || restaurantWhere ? 0 : skip,
      }),
      db.payment.count({ where }),
      db.payment.aggregate({ where, _sum: { amount: true } }),
      chargeWhere
        ? db.roomCharge.findMany({
            where: chargeWhere,
            include: roomChargeListInclude,
            orderBy: { createdAt: 'desc' },
            take: mergeWindow,
          })
        : Promise.resolve([]),
      chargeWhere ? db.roomCharge.count({ where: chargeWhere }) : Promise.resolve(0),
      restaurantWhere
        ? db.restaurantOrder.findMany({
            where: restaurantWhere,
            include: folioRestaurantListInclude,
            orderBy: { createdAt: 'desc' },
            take: mergeWindow,
          })
        : Promise.resolve([]),
      restaurantWhere
        ? db.restaurantOrder.count({ where: restaurantWhere })
        : Promise.resolve(0),
    ]);

    const sumAmount = sumResult._sum.amount ?? 0;

    if (!chargeWhere && !restaurantWhere) {
      return paginatedResponse(payments, total, page, limit, { sumAmount });
    }

    const merged = [
      ...payments.map((payment) => ({ ...payment, recordType: 'payment' as const })),
      ...chargeRows.map(mapRoomChargeToListRow),
      ...restaurantRows.map(mapFolioRestaurantToListRow),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(skip, skip + limit);

    return paginatedResponse(merged, total + chargeTotal + restaurantTotal, page, limit, {
      sumAmount,
    });
  } catch (error) {
    console.error('Error listing payments:', error);
    return errorResponse('Failed to fetch payments', 500);
  }
}

// POST /api/payments - Create payment record
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const user = authResult;
    const body = await request.json();
    const {
      amount,
      method,
      paymentType,
      bookingId,
      orderId,
      invoiceId,
      reference,
      accountLastFour,
      notes,
      sendToRoom,
      paymentCategoryId,
    } = body;

    // Validate amount
    if (!amount || amount <= 0) {
      return errorResponse('Payment amount must be greater than 0');
    }

    // A user-defined type is stored as OTHERS carrying its own label.
    let categoryLabel: string | null = null;
    if (typeof paymentCategoryId === 'string' && paymentCategoryId.trim()) {
      const category = await db.paymentCategory.findFirst({
        where: { id: paymentCategoryId.trim(), active: true },
        select: { name: true },
      });
      if (!category) {
        return errorResponse('Selected payment type is no longer available');
      }
      categoryLabel = category.name;
    }

    if (!categoryLabel) {
      if (!paymentType) {
        return errorResponse('Payment type is required');
      }
      if (!Object.values(PaymentType).includes(paymentType as PaymentType)) {
        return errorResponse('Invalid payment type');
      }
    }

    const resolvedPaymentType: PaymentType = categoryLabel
      ? 'OTHERS'
      : (paymentType as PaymentType);

    if (sendToRoom === true) {
      if (!bookingId || typeof bookingId !== 'string') {
        return errorResponse('Select a room before sending the charge');
      }
      if (!canAccessHotel(user.role)) {
        return errorResponse('You do not have permission to add room charges', 403);
      }
      if (!isManualRecordPaymentType(resolvedPaymentType)) {
        return errorResponse('Invalid room charge type');
      }

      const booking = await db.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          status: true,
          dueAmount: true,
          room: { select: { roomNumber: true } },
        },
      });
      if (!booking) {
        return errorResponse('Booking not found', 404);
      }
      if (booking.status !== 'CHECKED_IN') {
        return errorResponse('Room charges can only be sent to a checked-in guest', 400);
      }

      const chargeType: ChargeType =
        resolvedPaymentType === 'DAMAGE_CHARGES'
          ? 'DAMAGE'
          : resolvedPaymentType === 'OTHERS'
            ? 'OTHER'
            : 'EXTRA_SERVICE';
      const trimmedNotes = typeof notes === 'string' ? notes.trim() : '';
      const description = categoryLabel ?? formatPaymentTypeLabel(resolvedPaymentType);

      const roomCharge = await db.$transaction(async (tx) => {
        const charge = await tx.roomCharge.create({
          data: {
            bookingId,
            chargeType,
            description,
            notes: trimmedNotes || null,
            amount,
            quantity: 1,
            recordedBy: user.id,
          },
        });

        const updatedDueAmount = applyBookingChargeToStoredDue(booking.dueAmount ?? 0, amount);
        await tx.booking.update({
          where: { id: bookingId },
          data: { dueAmount: updatedDueAmount },
        });

        const invoiceId = await resolveActiveBookingInvoiceId(tx, bookingId);
        if (invoiceId) {
          const invoice = await tx.invoice.findUnique({
            where: { id: invoiceId },
            select: { status: true, paidAmount: true },
          });
          if (invoice) {
            await tx.invoiceItem.create({
              data: {
                invoiceId,
                itemType: 'extra_service',
                referenceId: charge.id,
                description,
                quantity: 1,
                unitPrice: amount,
                total: amount,
              },
            });

            const wasPaid = invoice.status === 'PAID';
            await tx.invoice.update({
              where: { id: invoiceId },
              data: {
                extraCharges: { increment: amount },
                subtotal: { increment: amount },
                totalAmount: { increment: amount },
                dueAmount: { increment: amount },
                ...(wasPaid
                  ? {
                      status: invoice.paidAmount > 0 ? 'PARTIALLY_PAID' : 'ISSUED',
                      paidAt: null,
                    }
                  : {}),
              },
            });
          }
        }

        return { ...charge, updatedDueAmount, invoiceId };
      });

      await logActivity(
        user.id,
        'ROOM_CHARGE_CREATED',
        'billing',
        JSON.stringify({
          roomChargeId: roomCharge.id,
          bookingId,
          roomNumber: booking.room.roomNumber,
          amount,
          chargeType,
          invoiceId: roomCharge.invoiceId || undefined,
        })
      );

      return successResponse(
        roomCharge,
        `৳${Number(amount).toLocaleString()} sent to Room ${booking.room.roomNumber}`,
        201
      );
    }

    if (!method) {
      return errorResponse('Payment method is required');
    }

    const resolvedMethod = parsePaymentMethod(method);
    if (resolvedMethod === 'NONE') {
      return errorResponse('Invalid payment method');
    }

    // Role-based validation
    if (bookingId && !canAccessHotel(user.role)) {
      return errorResponse('You do not have permission to create hotel payments', 403);
    }

    if (orderId) {
      return errorResponse(
        'Restaurant order payments must be recorded from CloudView Restaurant ledger after hotel clears the due',
        400
      );
    }

    // Validate booking exists if provided
    if (bookingId) {
      const booking = await db.booking.findUnique({ where: { id: bookingId } });
      if (!booking) {
        return errorResponse('Booking not found', 404);
      }
    }

    // Validate invoice exists if provided
    if (invoiceId) {
      const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) {
        return errorResponse('Invoice not found', 404);
      }
    }

    const trimmedReference = reference ? String(reference).trim() : '';
    const trimmedLastFour = accountLastFour ? String(accountLastFour).trim() : '';

    if (paymentRequiresReference(resolvedMethod) && !trimmedReference) {
      return errorResponse('Payment reference is required for this payment method');
    }
    if (
      paymentRequiresLastFour(resolvedMethod) &&
      (!trimmedLastFour || !isValidPaymentAccountLastFour(trimmedLastFour))
    ) {
      return errorResponse('Last 4 digits are required for card / bKash / Nagad / Upay payments');
    }

    const businessDate = await stampCurrentBusinessDate();

    let resolvedInvoiceId =
      typeof invoiceId === 'string' && invoiceId.trim() ? invoiceId.trim() : null;
    if (bookingId && !resolvedInvoiceId) {
      resolvedInvoiceId = await resolveActiveBookingInvoiceId(db, bookingId);
    }

    const payment = await db.payment.create({
      data: {
        amount,
        method: resolvedMethod,
        paymentType: resolvedPaymentType,
        categoryLabel,
        businessDate,
        bookingId: bookingId || null,
        orderId: null,
        invoiceId: resolvedInvoiceId,
        reference: paymentRequiresReference(resolvedMethod) ? trimmedReference : null,
        accountLastFour: paymentRequiresLastFour(resolvedMethod) ? trimmedLastFour : null,
        notes: notes || null,
        settlementSource: null,
        receivedBy: user.id,
      },
      include: {
        booking: {
          select: {
            id: true,
            dueAmount: true,
            customer: { select: { id: true, name: true } },
          },
        },
        order: {
          select: { id: true, orderNumber: true },
        },
      },
    });

    if (resolvedInvoiceId && isManualRecordPaymentType(resolvedPaymentType)) {
      await appendManualChargeInvoiceLine(db, {
        invoiceId: resolvedInvoiceId,
        paymentId: payment.id,
        paymentType: resolvedPaymentType,
        amount,
        notes: notes || null,
        categoryLabel,
      });
    }

    // Update booking dueAmount after payment
    let updatedDueAmount: number | null = null;
    if (bookingId) {
      const booking = await db.booking.findUnique({
        where: { id: bookingId },
        include: {
          invoices: {
            where: { status: { not: 'CANCELLED' } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { dueAmount: true, status: true },
          },
        },
      });
      if (booking) {
        let dueAmount: number;
        if (booking.status === 'CHECKED_IN') {
          dueAmount = applyBookingPaymentToStoredDue(booking.dueAmount ?? 0, amount);
        } else {
          const paymentRows = await db.payment.findMany({
            where: { bookingId },
            select: { amount: true, paymentType: true },
          });
          dueAmount = resolveBookingDisplayDue(
            booking,
            paymentRows,
            booking.invoices[0] ?? null
          );
        }
        updatedDueAmount = dueAmount;
        await db.booking.update({
          where: { id: bookingId },
          data: { dueAmount },
        });
      }
    }

    // Keep invoice paid/due in sync when the stay has an invoice (e.g. reg. no. payment).
    if (resolvedInvoiceId) {
      const synced = await syncInvoicePaymentTotals(db, resolvedInvoiceId);
      if (synced) {
        await db.booking.update({
          where: { id: synced.bookingId },
          data: { dueAmount: synced.dueAmount },
        });
        updatedDueAmount = synced.dueAmount;
      }
    }

    // Log activity
    await logActivity(
      user.id,
      'PAYMENT_CREATED',
      'billing',
      JSON.stringify({
        paymentId: payment.id,
        amount,
        method,
        paymentType: resolvedPaymentType,
        bookingId: bookingId || undefined,
        invoiceId: resolvedInvoiceId || undefined,
        orderId: orderId || undefined,
      })
    );

    return successResponse(
      { ...payment, updatedDueAmount },
      'Payment recorded successfully',
      201
    );
  } catch (error) {
    console.error('Error creating payment:', error);
    const detail = error instanceof Error ? error.message : '';
    if (detail.includes('PaymentType') || detail.includes('paymentType')) {
      return errorResponse(
        'Payment type is not available on this database. Deploy the latest migration and try again.',
        500
      );
    }
    return errorResponse('Failed to record payment', 500);
  }
}
