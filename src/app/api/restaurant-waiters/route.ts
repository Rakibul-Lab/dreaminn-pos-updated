import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessRestaurant, requireRole } from '@/lib/auth';
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils';

/** List waiters for POS (`forPos=1`) or management (default, includes order counts). */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    if (!canAccessRestaurant(authResult.role)) {
      return errorResponse('You do not have permission to view waiters', 403);
    }

    const forPos = request.nextUrl.searchParams.get('forPos') === '1';

    if (forPos) {
      const waiters = await db.restaurantWaiter.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          phone: true,
        },
        orderBy: { name: 'asc' },
      });
      return successResponse(waiters);
    }

    const waiters = await db.restaurantWaiter.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { orders: true },
        },
      },
    });

    return successResponse(waiters);
  } catch (error) {
    console.error('Restaurant waiters list error:', error);
    return errorResponse('Failed to fetch waiters', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN', 'RESTAURANT_STAFF');
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { name, phone, notes, active } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return errorResponse('Waiter name is required');
    }

    const waiter = await db.restaurantWaiter.create({
      data: {
        name: name.trim(),
        phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
        active: active !== false,
      },
    });

    await logActivity(authResult.id, 'CREATE_WAITER', 'restaurant', `Created waiter: ${waiter.name}`);

    return successResponse(waiter, 'Waiter created successfully', 201);
  } catch (error) {
    console.error('Restaurant waiter create error:', error);
    return errorResponse('Failed to create waiter', 500);
  }
}
