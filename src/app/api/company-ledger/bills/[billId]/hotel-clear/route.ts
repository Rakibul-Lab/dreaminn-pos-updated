import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { errorResponse, successResponse, logActivity } from '@/lib/api-utils';
import { clearHotelRestaurantBill } from '@/lib/cloudview-ledger';
import { RoleType } from '@prisma/client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ billId: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { billId } = await params;
    await clearHotelRestaurantBill(db, billId, authResult.id);

    await logActivity(
      authResult.id,
      'HOTEL_CLEAR_RESTAURANT_BILL',
      'company-ledger',
      JSON.stringify({ billId })
    );

    return successResponse(null, 'Hotel due cleared — restaurant can record payment');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to clear hotel due';
    return errorResponse(message, 400);
  }
}
