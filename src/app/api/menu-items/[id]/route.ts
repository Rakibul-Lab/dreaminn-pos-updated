import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';

// PUT /api/menu-items/[id] - Update menu item
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN');
    if (authResult instanceof Response) return authResult;

    const { id } = await params;
    const body = await request.json();
    const { categoryId, name, description, price, image, available, isVeg, preparationTime } = body;

    const existing = await db.menuItem.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse('Menu item');
    }

    if (categoryId) {
      const category = await db.menuCategory.findUnique({ where: { id: categoryId } });
      if (!category) {
        return errorResponse('Category not found');
      }
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (price !== undefined) updateData.price = Number(price);
    if (image !== undefined) updateData.image = image || null;
    if (available !== undefined) updateData.available = Boolean(available);
    if (isVeg !== undefined) updateData.isVeg = Boolean(isVeg);
    if (preparationTime !== undefined) updateData.preparationTime = preparationTime !== null ? Number(preparationTime) : null;
    if (categoryId !== undefined) updateData.categoryId = categoryId;

    const item = await db.menuItem.update({
      where: { id },
      data: updateData,
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    await logActivity(authResult.id, 'UPDATE_MENU_ITEM', 'restaurant', `Updated menu item: ${item.name}`);

    return successResponse(item, 'Menu item updated successfully');
  } catch (error) {
    console.error('Error updating menu item:', error);
    return errorResponse('Failed to update menu item', 500);
  }
}

// DELETE /api/menu-items/[id] - Delete menu item
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN');
    if (authResult instanceof Response) return authResult;

    const { id } = await params;

    const existing = await db.menuItem.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse('Menu item');
    }

    // Check if item is used in any orders
    const orderItemCount = await db.orderItem.count({
      where: { menuItemId: id },
    });

    if (orderItemCount > 0) {
      // Soft delete - just mark as unavailable
      await db.menuItem.update({
        where: { id },
        data: { available: false },
      });
      await logActivity(authResult.id, 'DELETE_MENU_ITEM', 'restaurant', `Soft-deleted menu item: ${existing.name} (has ${orderItemCount} order references)`);
      return successResponse(null, 'Menu item marked as unavailable (has order history)');
    }

    await db.menuItem.delete({ where: { id } });
    await logActivity(authResult.id, 'DELETE_MENU_ITEM', 'restaurant', `Deleted menu item: ${existing.name}`);

    return successResponse(null, 'Menu item deleted successfully');
  } catch (error) {
    console.error('Error deleting menu item:', error);
    return errorResponse('Failed to delete menu item', 500);
  }
}
