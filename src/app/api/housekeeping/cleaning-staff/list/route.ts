import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api-utils';
import { Prisma, RoleType } from '@prisma/client';

function mapStaffRows(
  staff: Array<{
    id: string;
    staffCode: string;
    name: string;
    phone: string | null;
    active: boolean;
    createdAt: Date;
    _count: { tasks: number };
    tasks: { status: string }[];
  }>
) {
  return staff.map((s) => {
    const pending = s.tasks.filter((t) => t.status === 'PENDING').length;
    const inProgress = s.tasks.filter((t) => t.status === 'IN_PROGRESS').length;
    const completed = s.tasks.filter((t) => t.status === 'COMPLETED').length;
    return {
      id: s.id,
      staffCode: s.staffCode,
      name: s.name,
      phone: s.phone,
      active: s.active,
      createdAt: s.createdAt,
      taskCounts: {
        total: s._count.tasks,
        pending,
        inProgress,
        completed,
      },
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim() ?? '';
    const includeInactive = searchParams.get('includeInactive') === 'true';
    const paginate = searchParams.get('paginate') !== 'false';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.CleaningStaffWhereInput = includeInactive ? {} : { active: true };
    if (search) {
      where.OR = [
        { staffCode: { contains: search } },
        { name: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const select = {
      id: true,
      staffCode: true,
      name: true,
      phone: true,
      active: true,
      createdAt: true,
      _count: {
        select: {
          tasks: true,
        },
      },
      tasks: {
        select: { status: true },
      },
    } as const;

    if (!paginate) {
      const staff = await db.cleaningStaff.findMany({
        where,
        select,
        orderBy: [{ name: 'asc' }, { staffCode: 'asc' }],
      });
      return successResponse(mapStaffRows(staff));
    }

    const [staff, total] = await Promise.all([
      db.cleaningStaff.findMany({
        where,
        select,
        orderBy: [{ name: 'asc' }, { staffCode: 'asc' }],
        skip,
        take: limit,
      }),
      db.cleaningStaff.count({ where }),
    ]);

    return paginatedResponse(mapStaffRows(staff), total, page, limit);
  } catch (error) {
    console.error('Cleaning staff list error:', error);
    return errorResponse('Failed to fetch cleaning staff list', 500);
  }
}
