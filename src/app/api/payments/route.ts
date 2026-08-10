import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessHotel, canAccessRestaurant } from '@/lib/auth';
import { successResponse, errorResponse, paginatedResponse, logActivity } from '@/lib/api-utils';
import { computeBookingRoomDue, resolveBookingDisplayDue, sumBookingNetPaid, applyBookingPaymentToStoredDue } from '@/lib/booking-totals';
import { PaymentType, PaymentMethod, Prisma } from '@prisma/client';
import {
  resolveActiveBookingInvoiceId,
  syncInvoicePaymentTotals,
  appendManualChargeInvoiceLine,
} from '@/lib/invoice-payments';
import { isManualRecordPaymentType } from '@/lib/payment-method';
import {
  parsePaymentMethod,
  paymentRequiresLastFour,
  paymentRequiresReference,
  isValidPaymentAccountLastFour,
} from '@/lib/payment-method';
import { stampCurrentBusinessDate } from '@/lib/business-date';
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
    const paymentType = searchParams.get('paymentType') as PaymentType | null;
    const settlementSource = searchParams.get('settlementSource');
    const method = searchParams.get('method') as PaymentMethod | null;
    const startDate = searchParams.get('startDate') || searchParams.get('dateFrom');
    const endDate = searchParams.get('endDate') || searchParams.get('dateTo');
    const search = searchParams.get('search')?.trim() || '';

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
    if (paymentType) {
      where.paymentType = paymentType;
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

    const [payments, total, sumResult] = await Promise.all([
      db.payment.findMany({
        where,
        include: paymentListInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.payment.count({ where }),
      db.payment.aggregate({ where, _sum: { amount: true } }),
    ]);

    return paginatedResponse(payments, total, page, limit, {
      sumAmount: sumResult._sum.amount ?? 0,
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
    } = body;

    // Validate amount
    if (!amount || amount <= 0) {
      return errorResponse('Payment amount must be greater than 0');
    }

    if (!paymentType) {
      return errorResponse('Payment type is required');
    }

    if (!Object.values(PaymentType).includes(paymentType as PaymentType)) {
      return errorResponse('Invalid payment type');
    }

    const resolvedPaymentType = paymentType as PaymentType;

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
