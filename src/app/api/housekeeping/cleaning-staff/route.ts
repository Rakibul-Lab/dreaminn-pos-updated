import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils';
import { Prisma, RoleType } from '@prisma/client';

function normalizeStaffCode(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType, 'HOUSEKEEPER' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim() ?? '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '15', 10), 50);

    const where: Prisma.CleaningStaffWhereInput = { active: true };
    if (search) {
      where.OR = [
        { staffCode: { contains: search } },
        { name: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const staff = await db.cleaningStaff.findMany({
      where,
      select: {
        id: true,
        staffCode: true,
        name: true,
        phone: true,
      },
      orderBy: [{ name: 'asc' }, { staffCode: 'asc' }],
      take: limit,
    });

    return successResponse(staff);
  } catch (error) {
    console.error('Cleaning staff list error:', error);
    return errorResponse('Failed to fetch cleaning staff', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const staffCode = normalizeStaffCode(body?.staffCode);
    const name = String(body?.name ?? '').trim();
    const phone = body?.phone ? String(body.phone).trim() : null;

    if (!staffCode) {
      return errorResponse('Staff ID is required');
    }
    if (!name) {
      return errorResponse('Staff name is required');
    }

    const existing = await db.cleaningStaff.findUnique({ where: { staffCode } });
    if (existing) {
      return errorResponse(`Staff ID "${staffCode}" is already in use`);
    }

    const staff = await db.cleaningStaff.create({
      data: {
        staffCode,
        name,
        phone,
      },
      select: {
        id: true,
        staffCode: true,
        name: true,
        phone: true,
      },
    });

    await logActivity(
      authResult.id,
      'CREATE_CLEANING_STAFF',
      'hotel',
      JSON.stringify({ cleaningStaffId: staff.id, staffCode: staff.staffCode, name: staff.name })
    );

    return successResponse(staff, 'Cleaning staff added successfully', 201);
  } catch (error) {
    console.error('Cleaning staff create error:', error);
    return errorResponse('Failed to add cleaning staff', 500);
  }
}
