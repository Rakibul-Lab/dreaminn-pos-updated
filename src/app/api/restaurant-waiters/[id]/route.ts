import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessRestaurant, requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    if (!canAccessRestaurant(authResult.role)) {
      return errorResponse('You do not have permission to view waiters', 403);
    }

    const { id } = await context.params;

    const waiter = await db.restaurantWaiter.findUnique({
      where: { id },
      include: {
        _count: {
          select: { orders: true },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            orderNumber: true,
            orderType: true,
            status: true,
            totalAmount: true,
            createdAt: true,
            room: {
              select: {
                roomNumber: true,
              },
            },
            table: {
              select: {
                tableNumber: true,
              },
            },
          },
        },
      },
    });

    if (!waiter) {
      return notFoundResponse('Waiter');
    }

    return successResponse(waiter);
  } catch (error) {
    console.error('Restaurant waiter detail error:', error);
    return errorResponse('Failed to fetch waiter', 500);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireRole(request, 'ADMIN', 'RESTAURANT_STAFF');
    if (authResult instanceof Response) return authResult;

    const { id } = await context.params;
    const body = await request.json();
    const { name, phone, notes, active } = body;

    const existing = await db.restaurantWaiter.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse('Waiter');
    }

    const updateData: {
      name?: string;
      phone?: string | null;
      notes?: string | null;
      active?: boolean;
    } = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return errorResponse('Waiter name is required');
      }
      updateData.name = name.trim();
    }
    if (phone !== undefined) {
      updateData.phone = typeof phone === 'string' && phone.trim() ? phone.trim() : null;
    }
    if (notes !== undefined) {
      updateData.notes = typeof notes === 'string' && notes.trim() ? notes.trim() : null;
    }
    if (active !== undefined) {
      updateData.active = Boolean(active);
    }

    const waiter = await db.restaurantWaiter.update({
      where: { id },
      data: updateData,
    });

    await logActivity(
      authResult.id,
      'UPDATE_WAITER',
      'restaurant',
      `Updated waiter: ${waiter.name}${active === false ? ' (deactivated)' : active === true ? ' (activated)' : ''}`
    );

    return successResponse(waiter, 'Waiter updated successfully');
  } catch (error) {
    console.error('Restaurant waiter update error:', error);
    return errorResponse('Failed to update waiter', 500);
  }
}
