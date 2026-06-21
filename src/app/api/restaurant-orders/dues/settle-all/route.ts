import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils';
import { parsePaymentMethod } from '@/lib/payment-method';
import { computeOrderDue } from '@/lib/restaurant-order-dues';
import {
  buildPaymentDateFilter,
  resolveRestaurantSettlementSource,
  settleRestaurantOrderInTx,
} from '@/lib/restaurant-order-settle';
import { Prisma } from '@prisma/client';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    if (authResult.role !== 'ADMIN' && authResult.role !== 'HOTEL_STAFF' && authResult.role !== 'HOTEL_FD') {
      return errorResponse('Only hotel staff can settle all restaurant dues in bulk', 403);
    }

    const body = await request.json();
    const method = parsePaymentMethod(body?.method, 'CASH');
    const reference = body?.reference ? String(body.reference).trim() : '';
    const notes = body?.notes ? String(body.notes).trim() : null;
    const orderType = body?.orderType as string | undefined;
    const search = body?.search ? String(body.search).trim() : '';
    const dateFrom = body?.dateFrom as string | undefined;
    const dateTo = body?.dateTo as string | undefined;
    const dateField = body?.dateField === 'settled' ? 'settled' : 'order';

    if (method === 'NONE') {
      return errorResponse('Invalid payment method');
    }
    if (!reference) {
      return errorResponse('Transaction / receipt number is required');
    }

    const where: Prisma.RestaurantOrderWhereInput = {
      status: { in: ['DELIVERED', 'READY'] },
      orderType: 'ROOM_SERVICE',
      bookingId: { not: null },
    };

    if (orderType && orderType !== 'all') {
      where.orderType = orderType as Prisma.EnumOrderTypeFilter;
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search } },
        { customerName: { contains: search } },
        { customerPhone: { contains: search } },
        { room: { roomNumber: { contains: search } } },
        { table: { tableNumber: { contains: search } } },
      ];
    }

    const dateFilter = buildPaymentDateFilter(dateFrom, dateTo);
    if (dateFilter) {
      if (dateField === 'settled') {
        where.payments = {
          some: {
            paymentType: 'RESTAURANT',
            createdAt: dateFilter,
          },
        };
      } else {
        where.createdAt = dateFilter;
      }
    }

    const orders = await db.restaurantOrder.findMany({
      where,
      include: {
        payments: { select: { amount: true, paymentType: true } },
        companyLedgerBill: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const openOrders = orders.filter((order) => {
      if (order.billingDisposition === 'HOTEL_BILL' || order.companyLedgerBill) return false;
      const { dueAmount } = computeOrderDue(order.totalAmount, order.payments);
      return dueAmount > 0.009;
    });

    if (!openOrders.length) {
      return errorResponse('No open restaurant dues to settle for the selected filters');
    }

    const settlementSource = resolveRestaurantSettlementSource(authResult.role);
    const results = await db.$transaction(async (tx) => {
      const settled: Array<{
        orderId: string;
        orderNumber: string;
        amount: number;
        remainingDue: number;
      }> = [];

      for (let i = 0; i < openOrders.length; i++) {
        const order = openOrders[i]!;
        const { dueAmount } = computeOrderDue(order.totalAmount, order.payments);
        const orderReference =
          openOrders.length === 1 ? reference : `${reference}-${i + 1}`;

        const result = await settleRestaurantOrderInTx(tx, order, {
          amount: dueAmount,
          method,
          reference: orderReference,
          notes: notes || `Bulk hotel due settlement (${reference})`,
          settlementSource,
          receivedBy: authResult.id,
        });

        settled.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount: result.payment.amount,
          remainingDue: result.remainingDue,
        });
      }

      return settled;
    });

    const totalSettled = results.reduce((sum, row) => sum + row.amount, 0);

    await logActivity(
      authResult.id,
      'RESTAURANT_DUES_SETTLE_ALL',
      'billing',
      JSON.stringify({
        reference,
        orderCount: results.length,
        totalSettled,
        settlementSource,
      })
    );

    return successResponse(
      {
        settledCount: results.length,
        totalSettled,
        orders: results,
      },
      `Settled ${results.length} order(s) — total ৳${totalSettled.toLocaleString()}`
    );
  } catch (error) {
    console.error('Restaurant settle-all error:', error);
    const message = error instanceof Error ? error.message : 'Failed to settle all restaurant dues';
    return errorResponse(message, 500);
  }
}
