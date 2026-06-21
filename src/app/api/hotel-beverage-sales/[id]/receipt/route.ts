import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';
import { formatPaymentMethod } from '@/lib/payment-method';
import { HOTEL_NAME } from '@/lib/reservation-terms';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    );
    if (authResult instanceof Response) return authResult;

    const { id } = await params;
    const sale = await db.hotelBeverageSale.findUnique({
      where: { id },
      include: {
        items: { orderBy: { itemName: 'asc' } },
        room: { select: { roomNumber: true } },
        creator: { select: { name: true } },
      },
    });

    if (!sale) return notFoundResponse('Beverage sale');

    const receipt = {
      hotelName: HOTEL_NAME,
      saleNumber: sale.saleNumber,
      saleType: sale.saleType,
      saleTypeLabel: sale.saleType === 'ROOM' ? 'Room charge' : 'Walk-in',
      createdAt: sale.createdAt.toISOString(),
      roomNumber: sale.room?.roomNumber ?? null,
      customerName: sale.customerName,
      customerPhone: sale.customerPhone,
      items: sale.items.map((item) => ({
        name: item.itemName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      subtotal: sale.subtotal,
      totalAmount: sale.totalAmount,
      payment: sale.paymentMethod
        ? {
            methodLabel: formatPaymentMethod(sale.paymentMethod),
            amount: sale.totalAmount,
            receivedBy: sale.creator?.name ?? null,
            paidAt: sale.createdAt.toISOString(),
          }
        : null,
      notes: sale.notes,
    };

    return successResponse(receipt);
  } catch (error) {
    console.error('Hotel beverage receipt error:', error);
    return errorResponse('Failed to load receipt', 500);
  }
}
