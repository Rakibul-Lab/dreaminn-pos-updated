import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessHotel, canAccessAdmin } from '@/lib/auth';
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils';
import { MANUAL_RECORD_PAYMENT_TYPE_OPTIONS } from '@/lib/payment-method';

const MAX_NAME_LENGTH = 40;

const BUILT_IN_NAMES = new Set(
  MANUAL_RECORD_PAYMENT_TYPE_OPTIONS.map((option) => option.label.toLowerCase())
);

// GET /api/payment-categories - User-defined payment types for Record New Payment
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const categories = await db.paymentCategory.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    return successResponse(categories);
  } catch (error) {
    console.error('Error listing payment categories:', error);
    return errorResponse('Failed to fetch payment types', 500);
  }
}

// POST /api/payment-categories - Add a payment type
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const user = authResult;
    if (!canAccessHotel(user.role) && !canAccessAdmin(user.role)) {
      return errorResponse('You do not have permission to add payment types', 403);
    }

    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';

    if (!name) {
      return errorResponse('Payment type name is required');
    }
    if (name.length > MAX_NAME_LENGTH) {
      return errorResponse(`Payment type name must be ${MAX_NAME_LENGTH} characters or fewer`);
    }
    if (BUILT_IN_NAMES.has(name.toLowerCase())) {
      return errorResponse('That payment type already exists');
    }

    const existing = await db.paymentCategory.findFirst({
      where: { name },
      select: { id: true, name: true, active: true },
    });

    if (existing) {
      if (existing.active) {
        return errorResponse('That payment type already exists');
      }
      const revived = await db.paymentCategory.update({
        where: { id: existing.id },
        data: { active: true },
        select: { id: true, name: true },
      });
      return successResponse(revived, 'Payment type added', 201);
    }

    const category = await db.paymentCategory.create({
      data: { name, createdBy: user.id },
      select: { id: true, name: true },
    });

    await logActivity(
      user.id,
      'PAYMENT_CATEGORY_CREATED',
      'billing',
      JSON.stringify({ paymentCategoryId: category.id, name: category.name })
    );

    return successResponse(category, 'Payment type added', 201);
  } catch (error) {
    console.error('Error creating payment category:', error);
    return errorResponse('Failed to add payment type', 500);
  }
}
