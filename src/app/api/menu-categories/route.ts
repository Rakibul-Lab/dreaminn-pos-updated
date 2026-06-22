import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';

import { isHotelBeverageMenuCategory } from '@/lib/hotel-beverage-sales';

// GET /api/menu-categories - List all categories with item counts, sorted by sortOrder
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const excludeHotelBeverage = searchParams.get('excludeHotelBeverage') === 'true';

    const categories = await db.menuCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    const filtered = excludeHotelBeverage
      ? categories.filter((category) => !isHotelBeverageMenuCategory(category))
      : categories;

    const result = filtered.map(({ _count, ...category }) => ({
      ...category,
      itemCount: _count.items,
    }));

    return successResponse(result);
  } catch (error) {
    console.error('Error fetching menu categories:', error);
    return errorResponse('Failed to fetch menu categories', 500);
  }
}

// POST /api/menu-categories - Create category (ADMIN and RESTAURANT_STAFF only)
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN');
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { name, description, active, sortOrder } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return errorResponse('Category name is required');
    }

    // Check for duplicate name
    const existing = await db.menuCategory.findFirst({
      where: { name: name.trim() },
    });
    if (existing) {
      return errorResponse('A category with this name already exists');
    }

    const category = await db.menuCategory.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        active: active !== undefined ? Boolean(active) : true,
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
      },
    });

    await logActivity(authResult.id, 'CREATE_MENU_CATEGORY', 'restaurant', `Created category: ${name}`);

    return successResponse(category, 'Category created successfully', 201);
  } catch (error) {
    console.error('Error creating menu category:', error);
    return errorResponse('Failed to create menu category', 500);
  }
}

// PUT /api/menu-categories - Update category (ADMIN and RESTAURANT_STAFF only)
export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN');
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { id, name, description, active, sortOrder } = body;

    if (!id) {
      return errorResponse('Category ID is required');
    }

    const existing = await db.menuCategory.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse('Menu category');
    }

    // Check for duplicate name if name is being changed
    if (name && name.trim() !== existing.name) {
      const duplicate = await db.menuCategory.findFirst({
        where: { name: name.trim(), NOT: { id } },
      });
      if (duplicate) {
        return errorResponse('A category with this name already exists');
      }
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (active !== undefined) updateData.active = Boolean(active);
    if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder);

    const category = await db.menuCategory.update({
      where: { id },
      data: updateData,
    });

    await logActivity(authResult.id, 'UPDATE_MENU_CATEGORY', 'restaurant', `Updated category: ${category.name}`);

    return successResponse(category, 'Category updated successfully');
  } catch (error) {
    console.error('Error updating menu category:', error);
    return errorResponse('Failed to update menu category', 500);
  }
}
