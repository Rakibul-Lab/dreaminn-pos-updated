import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils';
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
    const { categoryId, name, description, price, image, available, isVeg, preparationTime } = body as {
      categoryId?: string;
      name?: string;
      description?: string;
      price?: number;
      image?: string | null;
      available?: boolean;
      isVeg?: boolean;
      preparationTime?: number | null;
    };

    if (!name?.trim()) {
      return errorResponse('Beverage name is required');
    }
    if (!categoryId) {
      return errorResponse('Category is required');
    }
    if (price === undefined || price === null || Number(price) < 0) {
      return errorResponse('Valid price is required');
    }

    const category = await db.menuCategory.findUnique({ where: { id: categoryId } });
    if (!category) {
      return errorResponse('Category not found');
    }
    if (!isBeverageCategoryName(category.name)) {
      return errorResponse('Selected category is not a beverage category');
    }

    const item = await db.menuItem.create({
      data: {
        categoryId,
        name: name.trim(),
        description: description?.trim() || null,
        price: Number(price),
        image: image || null,
        available: available !== undefined ? Boolean(available) : true,
        isVeg: isVeg !== undefined ? Boolean(isVeg) : true,
        preparationTime:
          preparationTime !== undefined && preparationTime !== null
            ? Number(preparationTime)
            : null,
      },
      include: {
        category: { select: { id: true, name: true } },
      },
    });

    await logActivity(
      authResult.id,
      'CREATE_MENU_ITEM',
      'hotel',
      `Added beverage: ${item.name} (${category.name})`
    );

    return successResponse(item, 'Beverage added', 201);
  } catch (error) {
    console.error('Hotel beverage create error:', error);
    return errorResponse('Failed to add beverage', 500);
  }
}
