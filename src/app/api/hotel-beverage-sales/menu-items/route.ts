import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';
import { isBeverageCategoryName } from '@/lib/hotel-beverage-sales';

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
      select: { id: true, name: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });

    const beverageCategoryIds = categories
      .filter((c) => isBeverageCategoryName(c.name))
      .map((c) => c.id);

    if (beverageCategoryIds.length === 0) {
      return successResponse({ items: [], categories: [] });
    }

    const items = await db.menuItem.findMany({
      where: {
        categoryId: { in: beverageCategoryIds },
        available: true,
      },
      include: {
        category: { select: { id: true, name: true } },
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    });

    const categoriesWithCounts = categories
      .filter((c) => beverageCategoryIds.includes(c.id))
      .map((cat) => ({
        ...cat,
        itemCount: items.filter((item) => item.categoryId === cat.id).length,
      }));

    return successResponse({
      categories: categoriesWithCounts,
      items,
    });
  } catch (error) {
    console.error('Hotel beverage menu fetch error:', error);
    return errorResponse('Failed to load beverage items', 500);
  }
}
