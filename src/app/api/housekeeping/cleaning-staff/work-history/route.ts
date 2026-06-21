import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api-utils';
import { Prisma, RoleType } from '@prisma/client';

function workTimestamp(task: {
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}): Date {
  return task.startedAt ?? task.completedAt ?? task.createdAt;
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const staffId = searchParams.get('staffId')?.trim() || undefined;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 500);
    const skip = (page - 1) * limit;

    const where: Prisma.HousekeepingTaskWhereInput = {
      cleaningStaffId: { not: null },
    };
    if (staffId) {
      where.cleaningStaffId = staffId;
    }

    const [tasks, total] = await Promise.all([
      db.housekeepingTask.findMany({
        where,
        include: {
          room: { select: { roomNumber: true, floor: true } },
          cleaningStaff: {
            select: { id: true, staffCode: true, name: true, phone: true },
          },
        },
        orderBy: [{ startedAt: 'desc' }, { completedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      db.housekeepingTask.count({ where }),
    ]);

    const data = tasks
      .filter((t) => t.cleaningStaff)
      .map((t) => {
        const at = workTimestamp(t);
        return {
          id: t.id,
          staffId: t.cleaningStaff!.id,
          staffCode: t.cleaningStaff!.staffCode,
          staffName: t.cleaningStaff!.name,
          staffPhone: t.cleaningStaff!.phone,
          roomNumber: t.room.roomNumber,
          floor: t.room.floor,
          taskType: t.taskType,
          status: t.status,
          workAt: at.toISOString(),
          startedAt: t.startedAt?.toISOString() ?? null,
          completedAt: t.completedAt?.toISOString() ?? null,
          createdAt: t.createdAt.toISOString(),
          notes: t.notes,
        };
      });

    if (searchParams.get('paginate') === 'false') {
      return successResponse(data);
    }

    return paginatedResponse(data, total, page, limit);
  } catch (error) {
    console.error('Cleaning staff work history error:', error);
    return errorResponse('Failed to fetch work history', 500);
  }
}
