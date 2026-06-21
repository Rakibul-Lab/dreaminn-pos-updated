import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';

/** Assignable hotel staff for housekeeping tasks. */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const staff = await db.user.findMany({
      where: {
        active: true,
        role: { in: ['ADMIN', 'HOTEL_STAFF'] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: { name: 'asc' },
    });

    return successResponse(staff);
  } catch (error) {
    console.error('Housekeeping staff list error:', error);
    return errorResponse('Failed to fetch staff list', 500);
  }
}
