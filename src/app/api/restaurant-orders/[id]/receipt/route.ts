import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse } from '@/lib/api-utils';
import { getRestaurantName } from '@/lib/app-settings';
import { formatPaymentMethod } from '@/lib/payment-method';
import { resolveOrderBillingState, resolveRestaurantBalanceDisplay } from '@/lib/restaurant-order-billing';
import { computeOrderDue, formatOrderTypeLabel } from '@/lib/restaurant-order-dues';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;

    const order = await db.restaurantOrder.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            menuItem: { select: { name: true, isVeg: true } },
          },
        },
        room: { select: { roomNumber: true } },
        table: { select: { tableNumber: true } },
        payments: {
          where: { paymentType: 'RESTAURANT' },
          orderBy: { createdAt: 'asc' },
          include: {
            receiver: { select: { name: true } },
          },
        },
        companyLedgerBill: { select: { id: true } },
      },
    });

    if (!order) return notFoundResponse('Restaurant order');

    const billingState = resolveOrderBillingState(order);
    const { paidAmount, dueAmount } = computeOrderDue(order.totalAmount, order.payments);

    if (paidAmount <= 0.009) {
      return errorResponse('No payment recorded for this order yet', 400);
    }

    if (billingState === 'HOTEL_BILL' && dueAmount <= 0.009) {
      return errorResponse('This order was billed entirely to the hotel', 400);
    }

    const restaurantName = await getRestaurantName();

    const payments = order.payments.map((payment) => ({
      amount: payment.amount,
      method: payment.method,
      methodLabel: formatPaymentMethod(payment.method),
      reference: payment.reference,
      receivedBy: payment.receiver?.name ?? null,
      paidAt: payment.createdAt,
    }));

    const latestPayment = payments[payments.length - 1] ?? null;

    const balanceDisplay = resolveRestaurantBalanceDisplay(order);

    return successResponse({
      restaurantName,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      orderTypeLabel: formatOrderTypeLabel(order.orderType),
      billingState,
      createdAt: order.createdAt,
      roomNumber: order.room?.roomNumber ?? null,
      tableNumber: order.table?.tableNumber ?? null,
      customerName: order.customerName,
      items: order.items.map((item) => ({
        name: item.menuItem?.name ?? 'Item',
        quantity: item.quantity,
        unitPrice: item.price,
        lineTotal: item.price * item.quantity,
        isVeg: item.menuItem?.isVeg ?? false,
      })),
      subtotal: order.subtotal,
      discount: order.discount,
      vatPercent: order.vatPercent,
      vatAmount: order.vatAmount,
      totalAmount: order.totalAmount,
      paidAmount,
      balanceDue: dueAmount,
      isPartial: dueAmount > 0.009,
      balanceDestination: balanceDisplay.destination,
      balanceLabel: balanceDisplay.label,
      balanceNote: balanceDisplay.note,
      payments,
      payment: latestPayment,
    });
  } catch (error) {
    console.error('Restaurant receipt error:', error);
    return errorResponse('Failed to load receipt', 500);
  }
}
