import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';
import {
  HOTEL_BEVERAGE_CATEGORY_MARKER,
  isHotelBeverageMenuCategory,
} from '@/lib/hotel-beverage-sales';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    );
    if (authResult instanceof Response) return authResult;

    const categories = await db.menuCategory.findMany({
      where: { active: true },
      select: { id: true, name: true, sortOrder: true, description: true },
      orderBy: { sortOrder: 'asc' },
    });

    const beverageCategories = categories
      .filter((category) => isHotelBeverageMenuCategory(category))
      .map(({ description: _description, ...category }) => category);

    return successResponse(beverageCategories);
  } catch (error) {
    console.error('Hotel beverage categories fetch error:', error);
    return errorResponse('Failed to load beverage categories', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    );
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return errorResponse('Category name is required');
    }

    const existing = await db.menuCategory.findFirst({ where: { name } });
    if (existing) {
      return errorResponse('A category with this name already exists');
    }

    const maxSort = await db.menuCategory.aggregate({ _max: { sortOrder: true } });
    const sortOrder =
      body.sortOrder !== undefined ? Number(body.sortOrder) : (maxSort._max.sortOrder ?? 0) + 1;

    const category = await db.menuCategory.create({
      data: {
        name,
        description: HOTEL_BEVERAGE_CATEGORY_MARKER,
        active: true,
        sortOrder,
      },
      select: { id: true, name: true, sortOrder: true },
    });

    await logActivity(
      authResult.id,
      'CREATE_MENU_CATEGORY',
      'hotel',
      `Added hotel beverage category: ${category.name}`
    );

    return successResponse(category, 'Beverage category added', 201);
  } catch (error) {
    console.error('Hotel beverage category create error:', error);
    return errorResponse('Failed to add beverage category', 500);
  }
}
