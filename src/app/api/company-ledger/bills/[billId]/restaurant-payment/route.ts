import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { errorResponse, successResponse, logActivity } from '@/lib/api-utils';
import { recordRestaurantLedgerBillPayment } from '@/lib/cloudview-ledger';
import {
  parsePaymentMethod,
  paymentRequiresLastFour,
  paymentRequiresReference,
  isValidPaymentAccountLastFour,
} from '@/lib/payment-method';
import { RoleType } from '@prisma/client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ billId: string }> }
) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'RESTAURANT_STAFF' as RoleType
    );
    if (authResult instanceof Response) return authResult;

    const { billId } = await params;
    const body = await request.json();
    const amount = Number(body?.amount);
    const method = parsePaymentMethod(body?.method);
    const reference = typeof body?.reference === 'string' ? body.reference : '';
    const accountLastFour =
      typeof body?.accountLastFour === 'string' ? body.accountLastFour : null;
    const notes = typeof body?.notes === 'string' ? body.notes : null;

    if (!Number.isFinite(amount) || amount <= 0) {
      return errorResponse('Valid payment amount is required');
    }
    if (paymentRequiresReference(method) && !reference.trim()) {
      return errorResponse('Payment reference is required for this method');
    }
    if (paymentRequiresLastFour(method) && !isValidPaymentAccountLastFour(accountLastFour)) {
      return errorResponse('Enter exactly 4 digits for card / bKash / Nagad / Upay');
    }

    const result = await recordRestaurantLedgerBillPayment(db, {
      billId,
      amount,
      method,
      receivedBy: authResult.id,
      reference: reference.trim() || null,
      accountLastFour,
      notes,
    });

    await logActivity(
      authResult.id,
      'RESTAURANT_LEDGER_PAYMENT',
      'payments',
      JSON.stringify({ billId, paymentId: result.paymentId, amount })
    );

    return successResponse(result, 'Payment recorded');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record payment';
    return errorResponse(message, 400);
  }
}
