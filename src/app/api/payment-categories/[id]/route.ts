import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessHotel, canAccessAdmin } from '@/lib/auth';
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils';

// DELETE /api/payment-categories/[id] - Retire a user-defined payment type
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const user = authResult;
    if (!canAccessHotel(user.role) && !canAccessAdmin(user.role)) {
      return errorResponse('You do not have permission to remove payment types', 403);
    }

    const { id } = await params;
    const category = await db.paymentCategory.findUnique({
      where: { id },
      select: { id: true, name: true, active: true },
    });

    if (!category || !category.active) {
      return errorResponse('Payment type not found', 404);
    }

    // Deactivated rather than deleted so payments already recorded keep their label.
    await db.paymentCategory.update({
      where: { id },
      data: { active: false },
    });

    await logActivity(
      user.id,
      'PAYMENT_CATEGORY_REMOVED',
      'billing',
      JSON.stringify({ paymentCategoryId: category.id, name: category.name })
    );

    return successResponse({ id: category.id }, 'Payment type removed');
  } catch (error) {
    console.error('Error removing payment category:', error);
    return errorResponse('Failed to remove payment type', 500);
  }
}
