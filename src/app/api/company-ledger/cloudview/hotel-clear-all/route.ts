import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { errorResponse, successResponse, logActivity } from '@/lib/api-utils';
import {
  clearAllOpenHotelRestaurantBills,
  ensureCloudViewRestaurantLedger,
} from '@/lib/cloudview-ledger';
import { RoleType } from '@prisma/client';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const ledger = await ensureCloudViewRestaurantLedger(db);
    const count = await clearAllOpenHotelRestaurantBills(db, ledger.id, authResult.id);

    if (count === 0) {
      return errorResponse('No open hotel dues to clear');
    }

    await logActivity(
      authResult.id,
      'HOTEL_CLEAR_ALL_RESTAURANT_BILLS',
      'company-ledger',
      JSON.stringify({ companyLedgerId: ledger.id, count })
    );

    return successResponse({ count }, `Cleared ${count} hotel due(s) — restaurant can record payments`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to clear dues';
    return errorResponse(message, 400);
  }
}
