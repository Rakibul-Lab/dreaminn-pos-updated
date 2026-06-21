import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, requireHotelAccess, requireHotelManager } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';

function parseTotalPrice(body: Record<string, unknown>) {
  if (body.totalPrice === undefined && body.basePrice === undefined) {
    return {};
  }
  const raw = body.totalPrice ?? body.basePrice;
  return { totalPrice: Math.max(0, parseFloat(String(raw)) || 0) };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;

    const room = await db.room.findUnique({
      where: { id },
      include: { type: true },
    });

    if (!room) {
      return notFoundResponse('Room');
    }

    return successResponse(room);
  } catch (error) {
    console.error('Room fetch error:', error);
    return errorResponse('Failed to fetch room', 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireHotelAccess(request);
    if (authResult instanceof Response) return authResult;
    const authUser = await db.user.findUnique({
      where: { id: authResult.id },
      select: { id: true, active: true },
    });
    if (!authUser || !authUser.active) {
      return errorResponse('Session expired. Please log out and log in again.', 401);
    }

    const { id } = await params;
    const body = await request.json();

    const existing = await db.room.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse('Room');
    }

    const isFrontDeskOnly = authResult.role === 'HOTEL_FD';
    if (isFrontDeskOnly) {
      const hasRestrictedField =
        body.floor !== undefined ||
        body.typeId !== undefined ||
        body.roomNumber !== undefined ||
        body.totalPrice !== undefined ||
        body.basePrice !== undefined;
      if (hasRestrictedField || body.status === undefined) {
        return errorResponse('Front desk can only update room status', 403);
      }
    } else if (body.typeId) {
      const roomType = await db.roomType.findUnique({ where: { id: body.typeId } });
      if (!roomType) {
        return errorResponse('Room type not found');
      }
    }

    const updateData: Record<string, unknown> = {};
    if (body.status !== undefined) {
      const nextStatus = String(body.status);
      if (nextStatus !== 'AVAILABLE' && nextStatus !== 'MAINTENANCE') {
        return errorResponse('Room status can only be set to Available or Maintenance');
      }
      if (!['AVAILABLE', 'MAINTENANCE'].includes(existing.status)) {
        return errorResponse(
          'Room status cannot be changed while it is reserved, occupied, or dirty'
        );
      }
      const isValidTransition =
        nextStatus === existing.status ||
        (existing.status === 'AVAILABLE' && nextStatus === 'MAINTENANCE') ||
        (existing.status === 'MAINTENANCE' && nextStatus === 'AVAILABLE');
      if (!isValidTransition) {
        return errorResponse('Invalid room status transition');
      }
      updateData.status = nextStatus;
    }
    if (!isFrontDeskOnly) {
      if (body.floor !== undefined) updateData.floor = body.floor;
      if (body.typeId !== undefined) updateData.typeId = body.typeId;
      if (body.roomNumber !== undefined) updateData.roomNumber = body.roomNumber;
      Object.assign(updateData, parseTotalPrice(body));
    }

    const room = await db.room.update({
      where: { id },
      data: updateData,
      include: { type: true },
    });

    const statusChangedToCleaning =
      body.status !== undefined &&
      body.status === 'CLEANING' &&
      existing.status !== 'CLEANING';

    if (statusChangedToCleaning) {
      const existingActiveTask = await db.housekeepingTask.findFirst({
        where: {
          roomId: id,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          taskType: 'cleaning',
        },
      });

      if (!existingActiveTask) {
        await db.housekeepingTask.create({
          data: {
            roomId: id,
            taskType: 'cleaning',
            status: 'PENDING',
            notes: `Auto-created from room status change for room ${room.roomNumber}`,
          },
        });
      }
    }

    await logActivity(
      authResult.id,
      'UPDATE_ROOM',
      'hotel',
      JSON.stringify({
        roomId: id,
        changes: updateData,
        housekeepingTaskAutoCreated: statusChangedToCleaning,
      })
    );

    return successResponse(room, 'Room updated successfully');
  } catch (error) {
    console.error('Room update error:', error);
    return errorResponse('Failed to update room', 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireHotelManager(request);
    if (authResult instanceof Response) return authResult;
    if (authResult instanceof Response) return authResult;

    const { id } = await params;

    const existing = await db.room.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse('Room');
    }

    const room = await db.room.update({
      where: { id },
      data: { status: 'MAINTENANCE' },
      include: { type: true },
    });

    await logActivity(
      authResult.id,
      'DELETE_ROOM',
      'hotel',
      JSON.stringify({ roomId: id, roomNumber: existing.roomNumber, softDelete: true })
    );

    return successResponse(room, 'Room deleted (set to MAINTENANCE)');
  } catch (error) {
    console.error('Room delete error:', error);
    return errorResponse('Failed to delete room', 500);
  }
}
