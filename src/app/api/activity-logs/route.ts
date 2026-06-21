import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { errorResponse, paginatedResponse } from '@/lib/api-utils';

// GET /api/activity-logs - List activity logs with filters (ADMIN only)
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN');
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.max(1, Math.min(5000, parseInt(searchParams.get('limit') || '20')));
    const userId = searchParams.get('userId');
    const moduleFilter = searchParams.get('module');
    const action = searchParams.get('action');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const skip = (page - 1) * limit;

    // Build where clause
    const where: Record<string, unknown> = {};

    if (userId) {
      where.userId = userId;
    }

    if (moduleFilter) {
      where.module = moduleFilter;
    }

    if (action) {
      where.action = action;
    }

    // Date range filter
    if (startDate || endDate) {
      const createdAt: Record<string, unknown> = {};
      if (startDate) createdAt.gte = new Date(startDate);
      if (endDate) createdAt.lte = new Date(endDate);
      where.createdAt = createdAt;
    }

    const [logs, total] = await Promise.all([
      db.activityLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.activityLog.count({ where }),
    ]);

    return paginatedResponse(logs, total, page, limit);
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    return errorResponse('Failed to fetch activity logs', 500);
  }
}
