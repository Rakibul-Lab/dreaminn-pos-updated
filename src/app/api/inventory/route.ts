import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireInventoryAccess } from '@/lib/auth';
import {
  successResponse,
  errorResponse,
  paginatedResponse,
  notFoundResponse,
  logActivity,
} from '@/lib/api-utils';
import { Prisma } from '@prisma/client';

// GET /api/inventory - List inventory items with low-stock filter, paginated
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireInventoryAccess(request);
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const lowStock = searchParams.get('lowStock');
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.max(1, Math.min(5000, parseInt(searchParams.get('limit') || '20')));

    const where: Prisma.InventoryItemWhereInput = {};

    // Filter for low-stock items (quantity <= minQuantity)
    if (lowStock === 'true') {
      where.quantity = { lte: new Prisma.Decimal(0) };
      // We need a raw approach since Prisma doesn't support field comparison in where
      // Use a different approach: fetch all and filter, or use $queryRaw
      // For simplicity, we'll use a raw query approach
    }

    if (category) {
      where.category = category;
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { category: { contains: search } },
        { supplier: { contains: search } },
      ];
    }

    if (lowStock === 'true') {
      // Use raw query for low stock since SQLite doesn't support field comparison in Prisma
      const offset = (page - 1) * limit;

      const items = await db.$queryRaw<Array<{
        id: string;
        name: string;
        category: string | null;
        unit: string;
        quantity: number;
        minQuantity: number;
        costPerUnit: number | null;
        supplier: string | null;
        createdAt: string;
        updatedAt: string;
      }>>`
        SELECT * FROM inventory_items
        WHERE quantity <= min_quantity
        ${category ? Prisma.sql`AND category = ${category}` : Prisma.empty}
        ${search ? Prisma.sql`AND (name LIKE ${'%' + search + '%'} OR category LIKE ${'%' + search + '%'} OR supplier LIKE ${'%' + search + '%'})` : Prisma.empty}
        ORDER BY (min_quantity - quantity) DESC, name ASC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const countResult = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM inventory_items
        WHERE quantity <= min_quantity
        ${category ? Prisma.sql`AND category = ${category}` : Prisma.empty}
        ${search ? Prisma.sql`AND (name LIKE ${'%' + search + '%'} OR category LIKE ${'%' + search + '%'} OR supplier LIKE ${'%' + search + '%'})` : Prisma.empty}
      `;

      const total = Number(countResult[0]?.count ?? 0);

      return paginatedResponse(items, total, page, limit);
    }

    const [items, total] = await Promise.all([
      db.inventoryItem.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.inventoryItem.count({ where }),
    ]);

    return paginatedResponse(items, total, page, limit);
  } catch (error) {
    console.error('Error fetching inventory items:', error);
    return errorResponse('Failed to fetch inventory items', 500);
  }
}

// POST /api/inventory - Create inventory item (ADMIN only) or stock transaction
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Check if this is a stock transaction
    if (body.action === 'transaction') {
      return handleTransaction(request, body);
    }

    // Otherwise, create a new inventory item
    const authResult = await requireInventoryAccess(request);
    if (authResult instanceof Response) return authResult;

    const { name, category, categoryId, unit, quantity, minQuantity, costPerUnit, supplier } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return errorResponse('Item name is required');
    }

    if (!unit || typeof unit !== 'string' || !unit.trim()) {
      return errorResponse('Unit is required');
    }

    let resolvedCategoryId: string | null = null;
    let resolvedCategoryName: string | null = category?.trim() || null;

    if (categoryId && typeof categoryId === 'string' && categoryId.trim()) {
      const selectedCategory = await db.inventoryCategory.findUnique({
        where: { id: categoryId.trim() },
      });
      if (!selectedCategory || !selectedCategory.active) {
        return errorResponse('Selected category was not found');
      }
      resolvedCategoryId = selectedCategory.id;
      resolvedCategoryName = selectedCategory.name;
    } else if (resolvedCategoryName) {
      const byName = await db.inventoryCategory.findUnique({
        where: { name: resolvedCategoryName },
      });
      if (byName) {
        resolvedCategoryId = byName.id;
        resolvedCategoryName = byName.name;
      }
    }

    const item = await db.inventoryItem.create({
      data: {
        name: name.trim(),
        category: resolvedCategoryName,
        categoryId: resolvedCategoryId,
        unit: unit.trim(),
        quantity: quantity !== undefined ? Number(quantity) : 0,
        minQuantity: minQuantity !== undefined ? Number(minQuantity) : 0,
        costPerUnit: costPerUnit !== undefined ? Number(costPerUnit) : null,
        supplier: supplier?.trim() || null,
      },
    });

    await logActivity(authResult.id, 'CREATE_INVENTORY_ITEM', 'restaurant', `Created inventory item: ${name}`);

    return successResponse(item, 'Inventory item created successfully', 201);
  } catch (error) {
    console.error('Error creating inventory item:', error);
    return errorResponse('Failed to create inventory item', 500);
  }
}

// Handle stock transaction
async function handleTransaction(
  request: NextRequest,
  body: {
    itemId: string;
    type: string;
    quantity: number;
    notes?: string;
  }
) {
  try {
    const authResult = await requireInventoryAccess(request);
    if (authResult instanceof Response) return authResult;

    const { itemId, type, quantity, notes } = body;

    if (!itemId) {
      return errorResponse('Item ID is required for transaction');
    }

    const validTypes = ['in', 'out', 'waste'];
    if (!type || !validTypes.includes(type)) {
      return errorResponse(`Transaction type must be one of: ${validTypes.join(', ')}`);
    }

    if (!quantity || Number(quantity) <= 0) {
      return errorResponse('Transaction quantity must be greater than 0');
    }

    const item = await db.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) {
      return notFoundResponse('Inventory item');
    }

    // For 'out' and 'waste', check if enough stock
    const txQuantity = Number(quantity);
    if ((type === 'out' || type === 'waste') && item.quantity < txQuantity) {
      return errorResponse(
        `Insufficient stock. Current: ${item.quantity}, Requested: ${txQuantity}`
      );
    }

    // Update quantity and create transaction record
    const result = await db.$transaction(async (tx) => {
      const updatedItem = await tx.inventoryItem.update({
        where: { id: itemId },
        data: {
          quantity: type === 'in'
            ? { increment: txQuantity }
            : { decrement: txQuantity },
        },
      });

      const transaction = await tx.inventoryTransaction.create({
        data: {
          itemId,
          type,
          quantity: txQuantity,
          notes: notes || null,
          createdBy: authResult.id,
        },
      });

      return { item: updatedItem, transaction };
    });

    await logActivity(
      authResult.id,
      'INVENTORY_TRANSACTION',
      'restaurant',
      `${type.toUpperCase()} ${txQuantity} ${item.unit} of ${item.name}${notes ? ` - ${notes}` : ''}`
    );

    // Check for low stock after transaction and create notification
    if (result.item.quantity <= result.item.minQuantity) {
      try {
        await db.notification.create({
          data: {
            title: 'Low Stock Alert',
            message: `${item.name} is running low. Current: ${result.item.quantity} ${item.unit}, Minimum: ${result.item.minQuantity} ${item.unit}`,
            type: 'low_stock',
          },
        });
      } catch {
        // Silent fail for notifications
      }
    }

    return successResponse(result, 'Transaction completed successfully');
  } catch (error) {
    console.error('Error processing inventory transaction:', error);
    return errorResponse('Failed to process inventory transaction', 500);
  }
}

// PUT /api/inventory - Update inventory item
export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireInventoryAccess(request);
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { id, name, category, categoryId, unit, quantity, minQuantity, costPerUnit, supplier } = body;

    if (!id) {
      return errorResponse('Inventory item ID is required');
    }

    const existing = await db.inventoryItem.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse('Inventory item');
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (unit !== undefined) updateData.unit = unit.trim();
    if (quantity !== undefined) updateData.quantity = Number(quantity);
    if (minQuantity !== undefined) updateData.minQuantity = Number(minQuantity);
    if (costPerUnit !== undefined) updateData.costPerUnit = costPerUnit !== null ? Number(costPerUnit) : null;
    if (supplier !== undefined) updateData.supplier = supplier?.trim() || null;

    if (categoryId !== undefined || category !== undefined) {
      let resolvedCategoryId: string | null = null;
      let resolvedCategoryName: string | null = null;

      if (categoryId && typeof categoryId === 'string' && categoryId.trim()) {
        const selectedCategory = await db.inventoryCategory.findUnique({
          where: { id: categoryId.trim() },
        });
        if (!selectedCategory || !selectedCategory.active) {
          return errorResponse('Selected category was not found');
        }
        resolvedCategoryId = selectedCategory.id;
        resolvedCategoryName = selectedCategory.name;
      } else if (typeof category === 'string' && category.trim()) {
        const byName = await db.inventoryCategory.findUnique({
          where: { name: category.trim() },
        });
        resolvedCategoryName = category.trim();
        resolvedCategoryId = byName?.id ?? null;
      }

      updateData.category = resolvedCategoryName;
      updateData.categoryId = resolvedCategoryId;
    }

    const item = await db.inventoryItem.update({
      where: { id },
      data: updateData,
    });

    await logActivity(
      authResult.id,
      'UPDATE_INVENTORY_ITEM',
      'restaurant',
      `Updated inventory item: ${item.name}`
    );

    return successResponse(item, 'Inventory item updated successfully');
  } catch (error) {
    console.error('Error updating inventory item:', error);
    return errorResponse('Failed to update inventory item', 500);
  }
}
