import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAuth, canAccessRestaurant } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/api-utils';
import { readCurrentBusinessDateString, buildBusinessDateWhere } from '@/lib/business-date';

const STATUS_KEYS = ['PENDING', 'COOKING', 'READY', 'DELIVERED', 'CANCELLED'] as const;

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    if (!canAccessRestaurant(authResult.role)) {
      return errorResponse('You do not have permission to view order stats', 403);
    }

    const { searchParams } = new URL(request.url);
    const todayOnly = searchParams.get('today') === '1';
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const orderType = searchParams.get('orderType');

    const where: Prisma.RestaurantOrderWhereInput = {};

    if (orderType) {
      where.orderType = orderType as Prisma.EnumOrderTypeFilter;
    }

    if (todayOnly) {
      const businessDate = await readCurrentBusinessDateString();
      Object.assign(where, buildBusinessDateWhere(businessDate));
    } else if (dateFrom || dateTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (dateFrom) {
        const start = new Date(dateFrom);
        if (!Number.isNaN(start.getTime())) {
          start.setHours(0, 0, 0, 0);
          createdAt.gte = start;
        }
      }
      if (dateTo) {
        const end = new Date(dateTo);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          createdAt.lte = end;
        }
      }
      if (createdAt.gte || createdAt.lte) {
        where.createdAt = createdAt;
      }
    }

    const [groups, total] = await Promise.all([
      db.restaurantOrder.groupBy({
        by: ['status'],
        where,
        _count: { status: true },
      }),
      db.restaurantOrder.count({ where }),
    ]);

    const counts = {
      ALL: total,
      PENDING: 0,
      COOKING: 0,
      READY: 0,
      DELIVERED: 0,
      CANCELLED: 0,
    };

    for (const group of groups) {
      if (group.status in counts) {
        counts[group.status as keyof typeof counts] = group._count.status;
      }
    }

    return successResponse({ counts });
  } catch (error) {
    console.error('Order stats error:', error);
    return errorResponse('Failed to fetch order stats', 500);
  }
}
