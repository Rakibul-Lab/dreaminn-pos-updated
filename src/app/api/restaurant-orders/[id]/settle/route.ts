import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessRestaurant } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import { parsePaymentMethod } from '@/lib/payment-method';
import { computeOrderDue } from '@/lib/restaurant-order-dues';
import { postGuestFolioRemainderInTx } from '@/lib/restaurant-order-folio';
import { postRestaurantOrderToCloudViewLedger } from '@/lib/cloudview-ledger';
import { resolveRestaurantSettlementSource, settleRestaurantOrderInTx } from '@/lib/restaurant-order-settle';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    if (!canAccessRestaurant(authResult.role) && authResult.role !== 'HOTEL_STAFF' && authResult.role !== 'HOTEL_FD') {
      return errorResponse('You do not have permission to settle restaurant orders', 403);
    }

    const { id } = await params;
    const body = await request.json();
    const settleFull = body?.settleFull === true;
    const finalizeGuestFolioOnly = body?.finalizeGuestFolioOnly === true;
    const amountInput = settleFull ? null : Number(body?.amount);
    const method = parsePaymentMethod(body?.method, 'CASH');
    const reference = body?.reference ? String(body.reference).trim() : '';
    const notes = body?.notes ? String(body.notes).trim() : null;
    const postRemainderToGuestFolio = body?.postRemainderToGuestFolio !== false;
    const sendRemainderToHotelLedger = body?.sendRemainderToHotelLedger === true;

    const order = await db.restaurantOrder.findUnique({
      where: { id },
      include: {
        payments: { select: { amount: true, paymentType: true } },
        companyLedgerBill: { select: { id: true } },
      },
    });

    if (!order) return notFoundResponse('Restaurant order');

    const settlementSource =
      authResult.role === 'RESTAURANT_STAFF' || authResult.role === 'ADMIN'
        ? 'RESTAURANT_DIRECT'
        : resolveRestaurantSettlementSource(authResult.role);

    if (order.billingDisposition === 'HOTEL_BILL' || order.companyLedgerBill) {
      return errorResponse('This order was sent to hotel billing and cannot be paid here', 400);
    }
    if (order.billingDisposition === 'PAID_DIRECT') {
      return errorResponse('This order is already paid', 400);
    }

    const { dueAmount } = computeOrderDue(order.totalAmount, order.payments);

    if (finalizeGuestFolioOnly) {
      if (dueAmount <= 0.009) {
        return successResponse(
          {
            orderId: order.id,
            orderNumber: order.orderNumber,
            paidAmount: 0,
            remainingDue: 0,
            remainderOnGuestFolio: 0,
            guestFolioPosted: false,
            hotelLedgerPosted: false,
            isFullySettled: true,
          },
          'Order is already fully paid'
        );
      }

      const result = await db.$transaction(async (tx) => {
        const refreshedOrder = await tx.restaurantOrder.findUnique({
          where: { id },
          select: {
            id: true,
            orderNumber: true,
            orderType: true,
            bookingId: true,
            notes: true,
            totalAmount: true,
            payments: { select: { amount: true, paymentType: true } },
          },
        });

        if (!refreshedOrder) {
          throw new Error('Order not found');
        }

        const { dueAmount: currentDue } = computeOrderDue(
          refreshedOrder.totalAmount,
          refreshedOrder.payments
        );

        let guestFolioPosted = false;
        let remainderOnGuestFolio = currentDue;

        if (postRemainderToGuestFolio && currentDue > 0.009) {
          const folio = await postGuestFolioRemainderInTx(tx, refreshedOrder, currentDue);
          guestFolioPosted = folio.posted;
          remainderOnGuestFolio = folio.remainder;
        }

        let hotelLedgerPosted = false;
        if (sendRemainderToHotelLedger && currentDue > 0.009) {
          await postRestaurantOrderToCloudViewLedger(tx, id);
          hotelLedgerPosted = true;
        }

        return {
          remainingDue: currentDue,
          guestFolioPosted,
          remainderOnGuestFolio,
          hotelLedgerPosted,
        };
      });

      await logActivity(
        authResult.id,
        'RESTAURANT_ORDER_SETTLED',
        'billing',
        JSON.stringify({
          orderId: order.id,
          orderNumber: order.orderNumber,
          finalizeGuestFolioOnly: true,
          remainingDue: result.remainingDue,
          guestFolioPosted: result.guestFolioPosted,
          remainderOnGuestFolio: result.remainderOnGuestFolio,
          hotelLedgerPosted: result.hotelLedgerPosted,
        })
      );

      let message = 'Guest folio updated';
      if (result.guestFolioPosted && result.remainderOnGuestFolio > 0.009) {
        message = `৳${Math.round(result.remainderOnGuestFolio).toLocaleString()} posted to guest room bill`;
      }
      if (result.hotelLedgerPosted) {
        message += result.guestFolioPosted ? ' and sent to hotel ledger' : 'Remainder sent to hotel ledger';
      }

      return successResponse(
        {
          orderId: order.id,
          orderNumber: order.orderNumber,
          paidAmount: 0,
          remainingDue: result.remainingDue,
          remainderOnGuestFolio: result.remainderOnGuestFolio,
          guestFolioPosted: result.guestFolioPosted,
          hotelLedgerPosted: result.hotelLedgerPosted,
          isFullySettled: result.remainingDue <= 0.009,
        },
        message
      );
    }

    if (method === 'NONE') {
      return errorResponse('Invalid payment method');
    }
    const resolvedReference =
      reference || (method === 'CASH' ? `CASH-${id.slice(-8)}` : '');
    if (!resolvedReference) {
      return errorResponse('Transaction / receipt number is required');
    }

    const amount = settleFull ? dueAmount : amountInput;

    if (amount == null || Number.isNaN(amount) || amount <= 0) {
      return errorResponse('Payment amount must be greater than zero');
    }
    if (amount > dueAmount + 0.01) {
      return errorResponse(`Payment cannot exceed due amount (৳${dueAmount.toFixed(2)})`);
    }

    const result = await db.$transaction(async (tx) => {
      const settleResult = await settleRestaurantOrderInTx(tx, order, {
        amount: amount!,
        method,
        reference: resolvedReference,
        notes,
        settlementSource,
        receivedBy: authResult.id,
      });

      const refreshedOrder = await tx.restaurantOrder.findUnique({
        where: { id },
        select: {
          id: true,
          orderNumber: true,
          orderType: true,
          bookingId: true,
          notes: true,
          totalAmount: true,
          payments: { select: { amount: true, paymentType: true } },
        },
      });

      if (!refreshedOrder) {
        throw new Error('Order not found after payment');
      }

      let guestFolioPosted = false;
      let remainderOnGuestFolio = settleResult.remainingDue;

      if (postRemainderToGuestFolio && settleResult.remainingDue > 0.009) {
        const folio = await postGuestFolioRemainderInTx(
          tx,
          refreshedOrder,
          settleResult.remainingDue
        );
        guestFolioPosted = folio.posted;
        remainderOnGuestFolio = folio.remainder;
      }

      let hotelLedgerPosted = false;
      if (sendRemainderToHotelLedger && settleResult.remainingDue > 0.009) {
        await postRestaurantOrderToCloudViewLedger(tx, id);
        hotelLedgerPosted = true;
      }

      return {
        ...settleResult,
        guestFolioPosted,
        remainderOnGuestFolio,
        hotelLedgerPosted,
      };
    });

    await logActivity(
      authResult.id,
      'RESTAURANT_ORDER_SETTLED',
      'billing',
      JSON.stringify({
        orderId: order.id,
        orderNumber: order.orderNumber,
        amount: result.payment.amount,
        method,
        reference: resolvedReference,
        settlementSource: result.payment.settlementSource,
        remainingDue: result.remainingDue,
        guestFolioPosted: result.guestFolioPosted,
        remainderOnGuestFolio: result.remainderOnGuestFolio,
        hotelLedgerPosted: result.hotelLedgerPosted,
      })
    );

    let message = result.remainingDue <= 0.009 ? 'Order fully settled' : 'Partial payment recorded';
    if (result.guestFolioPosted && result.remainderOnGuestFolio > 0.009) {
      message = `Partial payment recorded — ৳${Math.round(result.remainderOnGuestFolio).toLocaleString()} posted to guest room bill`;
    }
    if (result.hotelLedgerPosted) {
      message += result.guestFolioPosted ? ' and sent to hotel ledger' : ' — remainder sent to hotel ledger';
    }

    return successResponse(
      {
        payment: result.payment,
        orderId: order.id,
        orderNumber: order.orderNumber,
        paidAmount: result.payment.amount,
        remainingDue: result.remainingDue,
        remainderOnGuestFolio: result.remainderOnGuestFolio,
        guestFolioPosted: result.guestFolioPosted,
        hotelLedgerPosted: result.hotelLedgerPosted,
        isFullySettled: result.remainingDue <= 0.009,
      },
      message
    );
  } catch (error) {
    console.error('Restaurant order settle error:', error);
    const message = error instanceof Error ? error.message : 'Failed to settle restaurant order';
    return errorResponse(message, 500);
  }
}
