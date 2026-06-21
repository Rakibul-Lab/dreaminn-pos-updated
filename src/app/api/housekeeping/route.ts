import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { HOUSEKEEPING_TASK_ROLES } from '@/lib/auth';
import { successResponse, paginatedResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';

const taskInclude = {
  room: true,
  cleaningStaff: {
    select: { id: true, staffCode: true, name: true, phone: true },
  },
  assigned: { select: { id: true, name: true, email: true, role: true } },
} as const;

async function resolveCleaningStaffId(cleaningStaffId: string) {
  const staff = await db.cleaningStaff.findFirst({
    where: { id: cleaningStaffId, active: true },
    select: { id: true },
  });
  if (!staff) {
    return null;
  }
  return staff.id;
}

function isHousekeeperRole(role: RoleType) {
  return role === 'HOUSEKEEPER';
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      ...(HOUSEKEEPING_TASK_ROLES as [RoleType, ...RoleType[]])
    );
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const roomId = searchParams.get('roomId');
    const cleaningStaffId = searchParams.get('cleaningStaffId');
    const taskType = searchParams.get('taskType');

    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (roomId) where.roomId = roomId;
    if (cleaningStaffId) where.cleaningStaffId = cleaningStaffId;
    if (taskType) where.taskType = taskType;

    const [tasks, total] = await Promise.all([
      db.housekeepingTask.findMany({
        where,
        include: taskInclude,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.housekeepingTask.count({ where }),
    ]);

    return paginatedResponse(tasks, total, page, limit);
  } catch (error) {
    console.error('Housekeeping list error:', error);
    return errorResponse('Failed to fetch housekeeping tasks', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      ...(HOUSEKEEPING_TASK_ROLES as [RoleType, ...RoleType[]])
    );
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { roomId, taskType, cleaningStaffId, notes } = body;

    if (!roomId || !taskType) {
      return errorResponse('Room ID and task type are required');
    }

    if (isHousekeeperRole(authResult.role) && taskType !== 'cleaning') {
      return errorResponse('Housekeepers can only create cleaning tasks', 403);
    }

    const room = await db.room.findUnique({ where: { id: roomId } });
    if (!room) {
      return notFoundResponse('Room');
    }

    let resolvedStaffId: string | null = null;
    if (cleaningStaffId) {
      resolvedStaffId = await resolveCleaningStaffId(String(cleaningStaffId));
      if (!resolvedStaffId) {
        return errorResponse('Cleaning staff not found');
      }
    }

    const task = await db.housekeepingTask.create({
      data: {
        roomId,
        taskType,
        cleaningStaffId: resolvedStaffId,
        notes,
      },
      include: taskInclude,
    });

    await logActivity(
      authResult.id,
      'CREATE_HOUSEKEEPING_TASK',
      'hotel',
      JSON.stringify({ taskId: task.id, roomId, taskType, cleaningStaffId: resolvedStaffId })
    );

    return successResponse(task, 'Housekeeping task created successfully', 201);
  } catch (error) {
    console.error('Housekeeping task creation error:', error);
    return errorResponse('Failed to create housekeeping task', 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      ...(HOUSEKEEPING_TASK_ROLES as [RoleType, ...RoleType[]])
    );
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { id, status, notes, cleaningStaffId } = body;

    if (!id) {
      return errorResponse('Task ID is required');
    }

    const existing = await db.housekeepingTask.findUnique({
      where: { id },
      include: { room: true },
    });

    if (!existing) {
      return notFoundResponse('Housekeeping task');
    }

    if (isHousekeeperRole(authResult.role)) {
      if (existing.taskType !== 'cleaning') {
        return errorResponse('Housekeepers can only update cleaning tasks', 403);
      }
      if (status !== undefined && status !== 'IN_PROGRESS' && status !== 'COMPLETED') {
        return errorResponse('Housekeepers can only start or complete cleaning tasks', 403);
      }
      if (existing.status === 'COMPLETED') {
        return errorResponse('This cleaning task is already completed', 403);
      }
    }

    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;

    if (cleaningStaffId !== undefined) {
      if (cleaningStaffId) {
        const resolvedStaffId = await resolveCleaningStaffId(String(cleaningStaffId));
        if (!resolvedStaffId) {
          return errorResponse('Cleaning staff not found');
        }
        updateData.cleaningStaffId = resolvedStaffId;
      } else {
        updateData.cleaningStaffId = null;
      }
    }

    if (status === 'IN_PROGRESS') {
      const staffId =
        (updateData.cleaningStaffId as string | null | undefined) ?? existing.cleaningStaffId;
      if (!staffId) {
        return errorResponse('Please assign cleaning staff before starting');
      }
      if (updateData.cleaningStaffId === undefined) {
        updateData.cleaningStaffId = staffId;
      }
      updateData.startedAt = new Date();
      await db.room.update({
        where: { id: existing.roomId },
        data: { status: 'CLEANING' },
      });
    }

    if (status === 'COMPLETED') {
      updateData.completedAt = new Date();

      if (existing.room.status === 'CLEANING') {
        await db.room.update({
          where: { id: existing.roomId },
          data: { status: 'AVAILABLE' },
        });
      }
    }

    const task = await db.housekeepingTask.update({
      where: { id },
      data: updateData,
      include: taskInclude,
    });

    await logActivity(
      authResult.id,
      'UPDATE_HOUSEKEEPING_TASK',
      'hotel',
      JSON.stringify({
        taskId: id,
        previousStatus: existing.status,
        newStatus: status,
        roomId: existing.roomId,
        roomStatusUpdated: status === 'COMPLETED' && existing.room.status === 'CLEANING',
      })
    );

    return successResponse(task, 'Housekeeping task updated successfully');
  } catch (error) {
    console.error('Housekeeping task update error:', error);
    return errorResponse('Failed to update housekeeping task', 500);
  }
}
