import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/notifications - List notifications with filters
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const user = authResult;
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type');
    const readParam = searchParams.get('read');

    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (userId) {
      where.userId = userId;
    } else {
      where.OR = [{ userId: user.id }, { userId: null }];
    }

    if (type) {
      where.type = type;
    }

    if (readParam !== null && readParam !== '') {
      where.read = readParam === 'true';
    }

    const [notifications, total, unreadCount] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.notification.count({ where }),
      db.notification.count({
        where: {
          OR: [{ userId: user.id }, { userId: null }],
          read: false,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: notifications,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        unreadCount,
      },
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return errorResponse('Failed to fetch notifications', 500);
  }
}

// PUT /api/notifications - Mark notification as read
export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const user = authResult;
    const body = await request.json();
    const { id, markAll } = body;

    if (markAll) {
      await db.notification.updateMany({
        where: {
          OR: [{ userId: user.id }, { userId: null }],
          read: false,
        },
        data: { read: true },
      });

      return successResponse({ markedAll: true }, 'All notifications marked as read');
    }

    if (!id) {
      return errorResponse('Notification ID is required');
    }

    const notification = await db.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      return notFoundResponse('Notification');
    }

    if (notification.userId && notification.userId !== user.id) {
      return errorResponse('You can only mark your own notifications as read', 403);
    }

    const updated = await db.notification.update({
      where: { id },
      data: { read: true },
    });

    return successResponse(updated, 'Notification marked as read');
  } catch (error) {
    console.error('Error updating notification:', error);
    return errorResponse('Failed to update notification', 500);
  }
}
