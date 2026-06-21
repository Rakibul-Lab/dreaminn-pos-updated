import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessRestaurant } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/api-utils';
import { readCurrentBusinessDateString, buildBusinessDateWhere } from '@/lib/business-date';

const TRACKED_STATUSES = ['PENDING', 'COOKING', 'READY', 'DELIVERED'] as const;

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    if (!canAccessRestaurant(authResult.role)) {
      return errorResponse('You do not have permission to view order stats', 403);
    }

    const businessDate = await readCurrentBusinessDateString();

    const groups = await db.restaurantOrder.groupBy({
      by: ['status'],
      where: {
        ...buildBusinessDateWhere(businessDate),
        status: { in: [...TRACKED_STATUSES] },
      },
      _count: { status: true },
    });

    const counts = {
      PENDING: 0,
      COOKING: 0,
      READY: 0,
      DELIVERED: 0,
    };

    for (const group of groups) {
      if (group.status in counts) {
        counts[group.status as keyof typeof counts] = group._count.status;
      }
    }

    return successResponse({
      date: businessDate,
      businessDate,
      counts,
    });
  } catch (error) {
    console.error('Today order stats error:', error);
    return errorResponse('Failed to fetch today order stats', 500);
  }
}
