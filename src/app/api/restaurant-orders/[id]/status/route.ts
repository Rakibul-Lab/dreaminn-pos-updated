import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  logActivity,
} from '@/lib/api-utils';

// Valid status transitions: can only move forward or cancel
const STATUS_ORDER = ['PENDING', 'COOKING', 'READY', 'DELIVERED'];

function canTransition(currentStatus: string, newStatus: string): boolean {
  // Allow cancellation from any non-delivered/non-cancelled state
  if (newStatus === 'CANCELLED') {
    return currentStatus !== 'DELIVERED' && currentStatus !== 'CANCELLED';
  }

  const currentIndex = STATUS_ORDER.indexOf(currentStatus);
  const newIndex = STATUS_ORDER.indexOf(newStatus);

  // Can only move forward (next step) or stay at same step
  if (newIndex === -1) return false;
  // Allow moving forward by exactly 1 step, or staying the same
  return newIndex === currentIndex + 1 || newIndex === currentIndex;
}

// PATCH /api/restaurant-orders/[id]/status - Update order status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN', 'RESTAURANT_STAFF');
    if (authResult instanceof Response) return authResult;

    const { id } = await params;

    const body = await request.json();
    const { status: newStatus } = body;

    if (!newStatus) {
      return errorResponse('Status is required');
    }

    const validStatuses = ['PENDING', 'COOKING', 'READY', 'DELIVERED', 'CANCELLED'];
    if (!validStatuses.includes(newStatus)) {
      return errorResponse(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    // Fetch the current order with table info
    const order = await db.restaurantOrder.findUnique({
      where: { id },
      include: {
        table: true,
        items: true,
      },
    });

    if (!order) {
      return notFoundResponse('Restaurant order');
    }

    // Validate status transition
    if (!canTransition(order.status, newStatus)) {
      return errorResponse(
        `Cannot transition from ${order.status} to ${newStatus}. Status must follow the workflow: PENDING → COOKING → READY → DELIVERED, or be CANCELLED.`
      );
    }

    // Determine KOT status based on order status
    let kotStatus: string | null = null;
    if (newStatus === 'COOKING') {
      kotStatus = 'cooking';
    } else if (newStatus === 'READY') {
      kotStatus = 'ready';
    } else if (newStatus === 'DELIVERED') {
      kotStatus = 'ready';
    }

    // Update order and related data in a transaction
    const updatedOrder = await db.$transaction(async (tx) => {
      // Update order status
      const updated = await tx.restaurantOrder.update({
        where: { id },
        data: { status: newStatus },
        include: {
          items: {
            include: {
              menuItem: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  isVeg: true,
                },
              },
            },
          },
          room: {
            select: {
              id: true,
              roomNumber: true,
              status: true,
            },
          },
          table: {
            select: {
              id: true,
              tableNumber: true,
              status: true,
            },
          },
        },
      });

      // Update KOT status for all order items
      if (kotStatus) {
        await tx.orderItem.updateMany({
          where: { orderId: id },
          data: { kotStatus },
        });
      }

      // When status = DELIVERED: for DINE_IN, set table status back to 'available'
      if (newStatus === 'DELIVERED' && order.orderType === 'DINE_IN' && order.tableId) {
        await tx.restaurantTable.update({
          where: { id: order.tableId },
          data: { status: 'available' },
        });
      }

      // When cancelled and DINE_IN, also free the table
      if (newStatus === 'CANCELLED' && order.orderType === 'DINE_IN' && order.tableId) {
        await tx.restaurantTable.update({
          where: { id: order.tableId },
          data: { status: 'available' },
        });
      }

      return updated;
    });

    // Log activity
    await logActivity(
      authResult.id,
      'UPDATE_ORDER_STATUS',
      'restaurant',
      `Order ${order.orderNumber} status changed from ${order.status} to ${newStatus}`
    );

    // Create notification for order_ready events
    if (newStatus === 'READY') {
      try {
        // Notify the order creator
        await db.notification.create({
          data: {
            userId: order.createdBy,
            title: 'Order Ready',
            message: `Order ${order.orderNumber} is ready for ${order.orderType === 'ROOM_SERVICE' ? 'room service delivery' : order.orderType === 'DINE_IN' ? 'serving' : 'pickup'}`,
            type: 'order_ready',
          },
        });

        // For room service, also notify hotel staff
        if (order.orderType === 'ROOM_SERVICE') {
          const hotelStaff = await db.user.findMany({
            where: { role: { in: ['HOTEL_STAFF', 'HOTEL_FD'] }, active: true },
            select: { id: true },
          });

          for (const staff of hotelStaff) {
            await db.notification.create({
              data: {
                userId: staff.id,
                title: 'Room Service Ready',
                message: `Order ${order.orderNumber} is ready for delivery to room ${updatedOrder.room?.roomNumber || 'unknown'}`,
                type: 'order_ready',
              },
            });
          }
        }
      } catch {
        // Silent fail for notifications
      }
    }

    return successResponse(updatedOrder, `Order status updated to ${newStatus}`);
  } catch (error) {
    console.error('Error updating order status:', error);
    return errorResponse('Failed to update order status', 500);
  }
}
