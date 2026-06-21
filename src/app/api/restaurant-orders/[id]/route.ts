import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse } from '@/lib/api-utils';
import { Prisma } from '@prisma/client';

// GET /api/restaurant-orders/[id] - Get order with full details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;

    const include: Prisma.RestaurantOrderInclude = {
      items: {
        include: {
          menuItem: {
            select: {
              id: true,
              name: true,
              price: true,
              isVeg: true,
              description: true,
              preparationTime: true,
            },
          },
        },
      },
      room: {
        select: {
          id: true,
          roomNumber: true,
          floor: true,
          status: true,
          type: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      table: {
        select: {
          id: true,
          tableNumber: true,
          capacity: true,
          status: true,
          location: true,
        },
      },
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      payments: {
        select: { amount: true, paymentType: true, settlementSource: true },
        orderBy: { createdAt: 'asc' },
      },
    };

    // HOTEL_STAFF and ADMIN can see full customer data via booking relation
    if (authResult.role === 'ADMIN' || authResult.role === 'HOTEL_STAFF' || authResult.role === 'HOTEL_FD') {
      include.booking = {
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              address: true,
              idType: true,
              idNumber: true,
            },
          },
        },
      };
    } else {
      // RESTAURANT_STAFF: Sees room number + order data only (no customer details)
      include.booking = {
        select: {
          id: true,
        },
      };
    }

    const order = await db.restaurantOrder.findUnique({
      where: { id },
      include,
    });

    if (!order) {
      return notFoundResponse('Restaurant order');
    }

    return successResponse(order);
  } catch (error) {
    console.error('Error fetching restaurant order:', error);
    return errorResponse('Failed to fetch restaurant order', 500);
  }
}
