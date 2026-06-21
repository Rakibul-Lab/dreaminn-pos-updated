import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils';
import { recordCompanyLedgerBillPayment } from '@/lib/company-ledger-billing';
import { parsePaymentMethod } from '@/lib/payment-method';
import { RoleType } from '@prisma/client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ billId: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { billId } = await params;
    const body = await request.json();
    const amount = parseFloat(String(body?.amount ?? 0));
    const method = parsePaymentMethod(body?.method, 'CASH');

    const result = await recordCompanyLedgerBillPayment(db, {
      billId,
      amount,
      method,
      receivedBy: authResult.id,
      reference: body?.reference,
      notes: body?.notes,
    });

    await logActivity(
      authResult.id,
      'COMPANY_LEDGER_PAYMENT',
      'company-ledger',
      JSON.stringify({ billId, amount, paymentId: result.paymentId })
    );

    return successResponse(result, 'Payment recorded successfully', 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record payment';
    return errorResponse(message, 400);
  }
}
