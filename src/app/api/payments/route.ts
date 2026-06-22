import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessHotel, canAccessRestaurant } from '@/lib/auth';
import { successResponse, errorResponse, paginatedResponse, logActivity } from '@/lib/api-utils';
import { computeBookingRoomDue, resolveBookingDisplayDue, sumBookingNetPaid, applyBookingPaymentToStoredDue } from '@/lib/booking-totals';
import { PaymentType, PaymentMethod, Prisma, InvoiceStatus } from '@prisma/client';
import {
  parsePaymentMethod,
  paymentRequiresLastFour,
  paymentRequiresReference,
  isValidPaymentAccountLastFour,
} from '@/lib/payment-method';
import { stampCurrentBusinessDate } from '@/lib/business-date';

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

    const skip = (page - 1) * limit;

    // Build where clause with role-based filtering
    const where: Prisma.PaymentWhereInput = {};

    // Role-based access control
    if (user.role === 'HOTEL_STAFF' || user.role === 'HOTEL_FD') {
      // Hotel staff: booking-linked payments (room charges + room-service / ledger settlements on guest folio)
      where.bookingId = { not: null };
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

    // Date range filter (inclusive days)
    if (startDate || endDate) {
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

    const [payments, total, sumResult] = await Promise.all([
      db.payment.findMany({
        where,
        include: {
          booking: {
            select: {
              id: true,
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
        },
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

    const payment = await db.payment.create({
      data: {
        amount,
        method: resolvedMethod,
        paymentType: resolvedPaymentType,
        businessDate,
        bookingId: bookingId || null,
        orderId: null,
        invoiceId: invoiceId || null,
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

    // Update invoice paid/due when payment is linked to an invoice
    if (invoiceId) {
      const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
      if (invoice) {
        const invoicePayments = await db.payment.findMany({
          where: { invoiceId },
          select: { amount: true, paymentType: true },
        });
        const paidAmount = sumBookingNetPaid(invoicePayments);
        const dueAmount = Math.max(0, invoice.totalAmount - paidAmount);
        let status: InvoiceStatus = invoice.status;
        if (dueAmount <= 0) {
          status = 'PAID';
        } else if (paidAmount > 0 && invoice.status !== 'CANCELLED') {
          status = 'PARTIALLY_PAID';
        }
        await db.invoice.update({
          where: { id: invoiceId },
          data: {
            paidAmount,
            dueAmount,
            status,
            paidAt: dueAmount <= 0 ? new Date() : null,
          },
        });
        await db.booking.update({
          where: { id: invoice.bookingId },
          data: { dueAmount },
        });
        if (updatedDueAmount == null) {
          updatedDueAmount = dueAmount;
        }
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
    return errorResponse('Failed to record payment', 500);
  }
}
