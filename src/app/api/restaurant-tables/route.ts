import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';

// GET /api/restaurant-tables - List all tables with status filter
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    }

    const tables = await db.restaurantTable.findMany({
      where,
      orderBy: { tableNumber: 'asc' },
    });

    return successResponse(tables);
  } catch (error) {
    console.error('Error fetching restaurant tables:', error);
    return errorResponse('Failed to fetch restaurant tables', 500);
  }
}

// POST /api/restaurant-tables - Create table (ADMIN and RESTAURANT_STAFF only)
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN', 'RESTAURANT_STAFF');
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { tableNumber, capacity, status, location } = body;

    if (!tableNumber || typeof tableNumber !== 'string' || !tableNumber.trim()) {
      return errorResponse('Table number is required');
    }

    // Check for duplicate table number
    const existing = await db.restaurantTable.findFirst({
      where: { tableNumber: tableNumber.trim() },
    });
    if (existing) {
      return errorResponse('A table with this number already exists');
    }

    const table = await db.restaurantTable.create({
      data: {
        tableNumber: tableNumber.trim(),
        capacity: capacity !== undefined ? Number(capacity) : 4,
        status: status || 'available',
        location: location?.trim() || null,
      },
    });

    await logActivity(authResult.id, 'CREATE_TABLE', 'restaurant', `Created table: ${tableNumber}`);

    return successResponse(table, 'Table created successfully', 201);
  } catch (error) {
    console.error('Error creating restaurant table:', error);
    return errorResponse('Failed to create restaurant table', 500);
  }
}

// PUT /api/restaurant-tables - Update table status (ADMIN and RESTAURANT_STAFF only)
export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN', 'RESTAURANT_STAFF');
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { id, tableNumber, capacity, status, location } = body;

    if (!id) {
      return errorResponse('Table ID is required');
    }

    const existing = await db.restaurantTable.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse('Restaurant table');
    }

    // Validate status if provided
    const validStatuses = ['available', 'occupied', 'reserved'];
    if (status && !validStatuses.includes(status)) {
      return errorResponse(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    // Check for duplicate table number if changing
    if (tableNumber && tableNumber.trim() !== existing.tableNumber) {
      const duplicate = await db.restaurantTable.findFirst({
        where: { tableNumber: tableNumber.trim(), NOT: { id } },
      });
      if (duplicate) {
        return errorResponse('A table with this number already exists');
      }
    }

    const updateData: Record<string, unknown> = {};
    if (tableNumber !== undefined) updateData.tableNumber = tableNumber.trim();
    if (capacity !== undefined) updateData.capacity = Number(capacity);
    if (status !== undefined) updateData.status = status;
    if (location !== undefined) updateData.location = location?.trim() || null;

    const table = await db.restaurantTable.update({
      where: { id },
      data: updateData,
    });

    await logActivity(
      authResult.id,
      'UPDATE_TABLE',
      'restaurant',
      `Updated table ${table.tableNumber}, status: ${table.status}`
    );

    return successResponse(table, 'Table updated successfully');
  } catch (error) {
    console.error('Error updating restaurant table:', error);
    return errorResponse('Failed to update restaurant table', 500);
  }
}
