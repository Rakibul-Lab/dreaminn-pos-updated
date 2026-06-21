import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  logActivity,
} from '@/lib/api-utils';
import { postRestaurantOrderToCloudViewLedger } from '@/lib/cloudview-ledger';
import { canSendOrderToHotel } from '@/lib/restaurant-order-billing';
import { RoleType } from '@prisma/client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'RESTAURANT_STAFF' as RoleType
    );
    if (authResult instanceof Response) return authResult;

    const { id } = await params;

    const order = await db.restaurantOrder.findUnique({
      where: { id },
      include: {
        companyLedgerBill: { select: { id: true } },
        payments: { select: { amount: true, paymentType: true } },
      },
    });

    if (!order) return notFoundResponse('Restaurant order');

    if (!canSendOrderToHotel(order)) {
      return errorResponse(
        'Only delivered room-service orders with a remaining balance can be sent to hotel billing',
        400
      );
    }

    await postRestaurantOrderToCloudViewLedger(db, id);

    await logActivity(
      authResult.id,
      'RESTAURANT_ORDER_HOTEL_BILL',
      'restaurant',
      JSON.stringify({ orderId: order.id, orderNumber: order.orderNumber })
    );

    return successResponse(
      { orderId: order.id, orderNumber: order.orderNumber, billingDisposition: 'HOTEL_BILL' },
      'Order sent to hotel billing'
    );
  } catch (error) {
    console.error('Send to hotel error:', error);
    const message = error instanceof Error ? error.message : 'Failed to send order to hotel';
    return errorResponse(message, 500);
  }
}
