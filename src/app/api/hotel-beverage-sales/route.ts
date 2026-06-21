import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, paginatedResponse, logActivity } from '@/lib/api-utils';
import { RoleType, type PaymentMethod, type Prisma } from '@prisma/client';
import {
  computeBeverageCartTotals,
  generateHotelBeverageSaleNumber,
  type BeverageCartLine,
} from '@/lib/hotel-beverage-sales';
import { buildHotelBeverageSalesWhere } from '@/lib/hotel-beverage-sales-list';
import { buildHotelBeverageSalesBusinessDayWhere } from '@/lib/hotel-beverage-sales-filter.server';
import { parsePaymentMethod } from '@/lib/payment-method';
import { readCurrentBusinessDateString } from '@/lib/business-date';

type SaleItemInput = {
  menuItemId: string;
  quantity: number;
};

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    );
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.max(1, Math.min(5000, parseInt(searchParams.get('limit') || '20', 10) || 20));
    const saleType = searchParams.get('saleType');
    const search = searchParams.get('search');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    const whereParts: Prisma.HotelBeverageSaleWhereInput[] = []

    const baseWhere = buildHotelBeverageSalesWhere({ saleType, search })
    if (Object.keys(baseWhere).length > 0) {
      whereParts.push(baseWhere)
    }

    const dateWhere = await buildHotelBeverageSalesBusinessDayWhere(dateFrom, dateTo)
    if (dateWhere) {
      whereParts.push(dateWhere)
    }

    const where =
      whereParts.length === 0
        ? {}
        : whereParts.length === 1
          ? whereParts[0]!
          : { AND: whereParts }

    const [sales, total, aggregate] = await Promise.all([
      db.hotelBeverageSale.findMany({
        where,
        include: {
          room: { select: { roomNumber: true } },
          items: true,
          creator: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.hotelBeverageSale.count({ where }),
      db.hotelBeverageSale.aggregate({
        where,
        _sum: { totalAmount: true, subtotal: true },
      }),
    ]);

    return paginatedResponse(sales, total, page, limit, {
      totalAmount: aggregate._sum.totalAmount ?? 0,
      subtotal: aggregate._sum.subtotal ?? 0,
    });
  } catch (error) {
    console.error('Hotel beverage sales list error:', error);
    return errorResponse('Failed to fetch beverage sales', 500);
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

    const authUser = await db.user.findUnique({
      where: { id: authResult.id },
      select: { id: true, active: true },
    });
    if (!authUser?.active) {
      return errorResponse('Session expired. Please log in again.', 401);
    }

    const body = await request.json();
    const {
      saleType,
      items,
      customerName,
      customerPhone,
      roomId,
      bookingId,
      paymentMethod,
      notes,
    } = body as {
      saleType?: string;
      items?: SaleItemInput[];
      customerName?: string;
      customerPhone?: string;
      roomId?: string;
      bookingId?: string;
      paymentMethod?: string;
      notes?: string;
    };

    if (saleType !== 'WALK_IN' && saleType !== 'ROOM') {
      return errorResponse('Sale type must be WALK_IN or ROOM');
    }

    if (!Array.isArray(items) || items.length === 0) {
      return errorResponse('Add at least one beverage item');
    }

    const menuItemIds = items.map((row) => String(row.menuItemId || '').trim()).filter(Boolean);
    const menuItems = await db.menuItem.findMany({
      where: { id: { in: menuItemIds }, available: true },
      include: { category: { select: { name: true } } },
    });

    if (menuItems.length !== new Set(menuItemIds).size) {
      return errorResponse('One or more beverage items are invalid or unavailable');
    }

    const menuById = new Map(menuItems.map((item) => [item.id, item]));
    const cartLines: BeverageCartLine[] = [];

    for (const row of items) {
      const menuItemId = String(row.menuItemId || '').trim();
      const menuItem = menuById.get(menuItemId);
      if (!menuItem) continue;
      const quantity = Math.max(1, parseInt(String(row.quantity ?? 1), 10) || 1);
      cartLines.push({
        menuItemId,
        name: menuItem.name,
        unitPrice: menuItem.price,
        quantity,
      });
    }

    if (cartLines.length === 0) {
      return errorResponse('Add at least one valid beverage item');
    }

    const { subtotal, totalAmount } = computeBeverageCartTotals(cartLines);
    if (totalAmount <= 0) {
      return errorResponse('Sale total must be greater than zero');
    }

    let resolvedBookingId: string | null = null;
    let resolvedRoomId: string | null = null;
    let roomNumber: string | null = null;

    if (saleType === 'ROOM') {
      if (!roomId && !bookingId) {
        return errorResponse('Select a checked-in room');
      }

      const booking = bookingId
        ? await db.booking.findUnique({
            where: { id: String(bookingId) },
            include: { room: { select: { id: true, roomNumber: true, status: true } } },
          })
        : await db.booking.findFirst({
            where: {
              roomId: String(roomId),
              status: 'CHECKED_IN',
            },
            include: { room: { select: { id: true, roomNumber: true, status: true } } },
            orderBy: { createdAt: 'desc' },
          });

      if (!booking || booking.status !== 'CHECKED_IN') {
        return errorResponse('Only checked-in rooms can be charged for beverages');
      }
      if (booking.room.status !== 'OCCUPIED') {
        return errorResponse('Selected room is not currently occupied');
      }

      resolvedBookingId = booking.id;
      resolvedRoomId = booking.roomId;
      roomNumber = booking.room.roomNumber;
    } else {
      if (!paymentMethod) {
        return errorResponse('Payment method is required for walk-in sales');
      }
    }

    const saleNumber = await generateHotelBeverageSaleNumber(db);
    const resolvedPayment =
      saleType === 'WALK_IN'
        ? parsePaymentMethod(String(paymentMethod), 'CASH')
        : null;
    const businessDate = await readCurrentBusinessDateString();

    const sale = await db.$transaction(async (tx) => {
      const created = await tx.hotelBeverageSale.create({
        data: {
          saleNumber,
          saleType,
          bookingId: resolvedBookingId,
          roomId: resolvedRoomId,
          customerName:
            saleType === 'WALK_IN'
              ? String(customerName || '').trim() || null
              : null,
          customerPhone:
            saleType === 'WALK_IN' && customerPhone ? String(customerPhone).trim() : null,
          subtotal,
          totalAmount,
          paymentMethod: resolvedPayment as PaymentMethod | null,
          notes: notes?.trim() || null,
          createdBy: authUser.id,
          items: {
            create: cartLines.map((line) => ({
              menuItemId: line.menuItemId,
              itemName: line.name,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: Math.round(line.unitPrice * line.quantity * 100) / 100,
            })),
          },
        },
        include: {
          items: true,
          room: { select: { roomNumber: true } },
        },
      });

      if (saleType === 'ROOM' && resolvedBookingId) {
        for (const line of cartLines) {
          await tx.roomCharge.create({
            data: {
              bookingId: resolvedBookingId,
              chargeType: 'MINIBAR',
              description: `Beverage: ${line.name}`,
              amount: line.unitPrice,
              quantity: line.quantity,
              hotelBeverageSaleId: created.id,
            },
          });
        }

        const booking = await tx.booking.findUnique({
          where: { id: resolvedBookingId },
          select: { dueAmount: true },
        });
        if (booking) {
          await tx.booking.update({
            where: { id: resolvedBookingId },
            data: { dueAmount: booking.dueAmount + totalAmount },
          });
        }
      }

      if (saleType === 'WALK_IN' && resolvedPayment) {
        await tx.payment.create({
          data: {
            amount: totalAmount,
            method: resolvedPayment,
            paymentType: 'FINAL',
            reference: saleNumber,
            notes: `Beverage walk-in sale ${saleNumber}`,
            businessDate,
            receivedBy: authUser.id,
          },
        });
      }

      return created;
    });

    await logActivity(
      authUser.id,
      'CREATE_BEVERAGE_SALE',
      'hotel',
      JSON.stringify({
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        saleType: sale.saleType,
        totalAmount: sale.totalAmount,
        roomNumber: sale.room?.roomNumber ?? roomNumber,
      })
    );

    return successResponse(sale, 201);
  } catch (error) {
    console.error('Hotel beverage sale create error:', error);
    return errorResponse('Failed to complete beverage sale', 500);
  }
}
