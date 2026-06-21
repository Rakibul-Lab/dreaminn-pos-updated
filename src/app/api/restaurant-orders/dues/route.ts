import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessRestaurant } from '@/lib/auth';
import { errorResponse, paginatedResponse } from '@/lib/api-utils';
import { computeOrderDue, isHotelFolioRestaurantOrder } from '@/lib/restaurant-order-dues';
import { buildPaymentDateFilter } from '@/lib/restaurant-order-settle';
import { Prisma } from '@prisma/client';

function mapOrderDueRow(
  order: {
    id: string;
    orderNumber: string;
    orderType: string;
    status: string;
    customerName: string | null;
    customerPhone: string | null;
    subtotal: number;
    discount: number;
    vatAmount: number;
    vatPercent: number;
    totalAmount: number;
    notes: string | null;
    createdAt: Date;
    bookingId: string | null;
    room: { id: string; roomNumber: string; floor?: number } | null;
    table: { id: string; tableNumber: string } | null;
    creator: { id: string; name: string } | null;
    items: Array<{
      id: string;
      quantity: number;
      price: number;
      notes: string | null;
      menuItem: { id: string; name: string; isVeg: boolean };
    }>;
    payments: Array<{
      id: string;
      amount: number;
      method: string;
      paymentType: string;
      reference: string | null;
      notes: string | null;
      settlementSource: string | null;
      createdAt: Date;
      receiver: { id: string; name: string; role: string };
    }>;
    booking?: {
      id: string;
      status: string;
      checkOut?: Date | null;
      customer?: { id: string; name: string; phone: string } | null;
    } | null;
  },
  dueStatus: 'open' | 'settled' | 'all'
) {
  const { paidAmount, dueAmount, isSettled } = computeOrderDue(
    order.totalAmount,
    order.payments
  );

  if (dueStatus === 'open' && isSettled) return null;
  if (dueStatus === 'settled' && !isSettled) return null;

  const guestName =
    order.customerName ||
    order.booking?.customer?.name ||
    null;
  const guestPhone =
    order.customerPhone ||
    order.booking?.customer?.phone ||
    null;

  const lastSettlement = order.payments[0] ?? null;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    status: order.status,
    customerName: guestName,
    customerPhone: guestPhone,
    subtotal: order.subtotal,
    discount: order.discount,
    vatAmount: order.vatAmount,
    vatPercent: order.vatPercent,
    totalAmount: order.totalAmount,
    paidAmount,
    dueAmount,
    isSettled,
    notes: order.notes,
    createdAt: order.createdAt,
    settledAt: isSettled ? (lastSettlement?.createdAt ?? null) : null,
    bookingId: order.bookingId,
    billedToRoom: isHotelFolioRestaurantOrder(order),
    hotelFolioOrder: isHotelFolioRestaurantOrder(order),
    bookingStatus: order.booking?.status ?? null,
    guestPaidAtHotel: order.booking?.status === 'CHECKED_OUT',
    guestCheckoutAt: order.booking?.checkOut ?? null,
    room: order.room,
    table: order.table,
    creator: order.creator,
    items: order.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      price: item.price,
      lineTotal: item.quantity * item.price,
      notes: item.notes,
      menuItem: item.menuItem,
    })),
    payments: order.payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      paymentType: p.paymentType,
      reference: p.reference,
      notes: p.notes,
      settlementSource: p.settlementSource,
      createdAt: p.createdAt,
      receiver: p.receiver,
    })),
  };
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    if (!canAccessRestaurant(authResult.role) && authResult.role !== 'HOTEL_STAFF' && authResult.role !== 'HOTEL_FD') {
      return errorResponse('You do not have permission to view restaurant dues', 403);
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 50);
    const orderType = searchParams.get('orderType');
    const search = searchParams.get('search')?.trim() ?? '';
    const dateFrom = searchParams.get('dateFrom') || searchParams.get('startDate') || undefined;
    const dateTo = searchParams.get('dateTo') || searchParams.get('endDate') || undefined;
    const dateField = searchParams.get('dateField') === 'settled' ? 'settled' : 'order';
    const dueStatusParam = searchParams.get('dueStatus');
    const dueStatus: 'open' | 'settled' | 'all' =
      dueStatusParam === 'settled' || dueStatusParam === 'all' ? dueStatusParam : 'open';
    const billCategory = searchParams.get('billCategory') || 'hotel';

    const where: Prisma.RestaurantOrderWhereInput = {
      status: { in: ['DELIVERED', 'READY'] },
    };

    if (billCategory === 'hotel') {
      where.orderType = 'ROOM_SERVICE';
      where.bookingId = { not: null };
    } else if (billCategory === 'counter') {
      where.OR = [
        { orderType: 'DINE_IN' },
        { orderType: 'TAKEAWAY' },
        { orderType: 'ROOM_SERVICE', bookingId: null },
      ];
    }

    if (orderType && orderType !== 'all') {
      where.orderType = orderType as Prisma.EnumOrderTypeFilter;
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search } },
        { customerName: { contains: search } },
        { customerPhone: { contains: search } },
        { room: { roomNumber: { contains: search } } },
        { table: { tableNumber: { contains: search } } },
      ];
    }

    const dateFilter = buildPaymentDateFilter(dateFrom, dateTo);
    if (dateFilter) {
      if (dateField === 'settled') {
        where.payments = {
          some: {
            paymentType: 'RESTAURANT',
            createdAt: dateFilter,
          },
        };
      } else {
        where.createdAt = dateFilter;
      }
    }

    const include: Prisma.RestaurantOrderInclude = {
      items: {
        include: {
          menuItem: {
            select: { id: true, name: true, isVeg: true },
          },
        },
      },
      room: { select: { id: true, roomNumber: true, floor: true } },
      table: { select: { id: true, tableNumber: true } },
      creator: { select: { id: true, name: true } },
      payments: {
        orderBy: { createdAt: 'desc' },
        include: {
          receiver: { select: { id: true, name: true, role: true } },
        },
      },
    };

    include.booking = {
      select: {
        id: true,
        status: true,
        checkOut: true,
        customer: { select: { id: true, name: true, phone: true } },
      },
    };

    const orders = await db.restaurantOrder.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' },
    });

    const rows = orders
      .map((order) => mapOrderDueRow(order, dueStatus))
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const openRows = rows.filter((r) => r.dueAmount > 0.009);
    const totalDueSum = openRows.reduce((sum, row) => sum + row.dueAmount, 0);
    const total = rows.length;
    const skip = (page - 1) * limit;
    const pageRows = rows.slice(skip, skip + limit);

    return paginatedResponse(pageRows, total, page, limit, {
      totalDueSum,
      openCount: openRows.length,
      settledCount: rows.filter((r) => r.isSettled).length,
    });
  } catch (error) {
    console.error('Restaurant dues list error:', error);
    return errorResponse('Failed to fetch restaurant dues', 500);
  }
}
