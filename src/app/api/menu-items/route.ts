import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, requireRole } from '@/lib/auth';
import { successResponse, errorResponse, paginatedResponse, logActivity } from '@/lib/api-utils';
import { Prisma } from '@prisma/client';

// GET /api/menu-items - List menu items with filters, paginated
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get('categoryId');
    const available = searchParams.get('available');
    const search = searchParams.get('search');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.max(1, Math.min(5000, parseInt(searchParams.get('limit') || '20')));

    const where: Prisma.MenuItemWhereInput = {};

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (available !== null && available !== undefined && available !== '') {
      where.available = available === 'true';
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const [items, total] = await Promise.all([
      db.menuItem.findMany({
        where,
        include: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.menuItem.count({ where }),
    ]);

    return paginatedResponse(items, total, page, limit);
  } catch (error) {
    console.error('Error fetching menu items:', error);
    return errorResponse('Failed to fetch menu items', 500);
  }
}

// POST /api/menu-items - Create menu item (ADMIN and RESTAURANT_STAFF only)
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN');
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { categoryId, name, description, price, image, available, isVeg, preparationTime } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return errorResponse('Menu item name is required');
    }

    if (!categoryId) {
      return errorResponse('Category ID is required');
    }

    if (price === undefined || price === null || Number(price) < 0) {
      return errorResponse('Valid price is required');
    }

    // Verify category exists
    const category = await db.menuCategory.findUnique({ where: { id: categoryId } });
    if (!category) {
      return errorResponse('Category not found');
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
        preparationTime: preparationTime !== undefined ? Number(preparationTime) : null,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    await logActivity(authResult.id, 'CREATE_MENU_ITEM', 'restaurant', `Created menu item: ${name}`);

    return successResponse(item, 'Menu item created successfully', 201);
  } catch (error) {
    console.error('Error creating menu item:', error);
    return errorResponse('Failed to create menu item', 500);
  }
}
