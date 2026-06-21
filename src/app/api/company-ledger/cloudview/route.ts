import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessHotel, canAccessRestaurant, canAccessAdmin } from '@/lib/auth';
import { errorResponse, successResponse } from '@/lib/api-utils';
import { ensureCloudViewRestaurantLedger } from '@/lib/cloudview-ledger';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const user = authResult;
    const canView =
      canAccessAdmin(user.role) ||
      canAccessHotel(user.role) ||
      canAccessRestaurant(user.role);
    if (!canView) {
      return errorResponse('Access denied', 403);
    }

    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage'); // OPEN | HOTEL_CLEARED | PAID | all
    const sort = searchParams.get('sort') || 'newest'; // newest | oldest | amount_desc | amount_asc
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const search = searchParams.get('search')?.trim();

    const ledger = await ensureCloudViewRestaurantLedger(db);

    const where: Prisma.CompanyLedgerBillWhereInput = {
      companyLedgerId: ledger.id,
      billType: 'RESTAURANT_ORDER',
    };

    if (stage && stage !== 'all') {
      where.settlementStage = stage as Prisma.EnumLedgerSettlementStageFilter;
    }

    if (dateFrom || dateTo) {
      const billedAt: Prisma.DateTimeFilter = {};
      if (dateFrom) {
        const start = new Date(dateFrom);
        if (!Number.isNaN(start.getTime())) {
          start.setHours(0, 0, 0, 0);
          billedAt.gte = start;
        }
      }
      if (dateTo) {
        const end = new Date(dateTo);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          billedAt.lte = end;
        }
      }
      if (billedAt.gte || billedAt.lte) where.billedAt = billedAt;
    }

    if (search) {
      where.OR = [
        { guestName: { contains: search } },
        { orderNumber: { contains: search } },
        { roomNumber: { contains: search } },
      ];
    }

    const orderBy: Prisma.CompanyLedgerBillOrderByWithRelationInput[] =
      sort === 'oldest'
        ? [{ billedAt: 'asc' }]
        : sort === 'amount_desc'
          ? [{ dueAmount: 'desc' }, { billedAt: 'desc' }]
          : sort === 'amount_asc'
            ? [{ dueAmount: 'asc' }, { billedAt: 'desc' }]
            : [{ billedAt: 'desc' }];

    const baseWhere: Prisma.CompanyLedgerBillWhereInput = {
      companyLedgerId: ledger.id,
      billType: 'RESTAURANT_ORDER',
    };

    const [bills, openAgg, clearedAgg] = await Promise.all([
      db.companyLedgerBill.findMany({
        where,
        orderBy,
        include: {
          restaurantOrder: {
            select: {
              id: true,
              orderNumber: true,
              orderType: true,
              status: true,
              totalAmount: true,
              createdAt: true,
            },
          },
          hotelClearer: { select: { id: true, name: true } },
        },
      }),
      db.companyLedgerBill.aggregate({
        where: {
          ...baseWhere,
          settlementStage: 'OPEN',
          dueAmount: { gt: 0 },
        },
        _count: { _all: true },
        _sum: { dueAmount: true },
      }),
      db.companyLedgerBill.aggregate({
        where: {
          ...baseWhere,
          settlementStage: 'HOTEL_CLEARED',
          dueAmount: { gt: 0 },
        },
        _count: { _all: true },
        _sum: { dueAmount: true },
      }),
    ]);

    const openCount = openAgg._count._all;
    const hotelClearedCount = clearedAgg._count._all;
    const totalOpenDue = openAgg._sum.dueAmount ?? 0;
    const totalClearedDue = clearedAgg._sum.dueAmount ?? 0;

    return successResponse({
      ledger: {
        id: ledger.id,
        name: ledger.name,
        slug: ledger.slug,
        isSystem: ledger.isSystem,
        totalBilled: ledger.totalBilled,
        totalPaid: ledger.totalPaid,
        dueAmount: ledger.dueAmount,
      },
      bills,
      meta: {
        openCount,
        hotelClearedCount,
        totalOpenDue,
        totalClearedDue,
        canHotelClear: canAccessAdmin(user.role) || user.role === 'HOTEL_STAFF' || user.role === 'HOTEL_FD',
        canRecordPayment:
          canAccessAdmin(user.role) || canAccessRestaurant(user.role),
      },
    });
  } catch (error) {
    console.error('CloudView ledger error:', error);
    return errorResponse('Failed to load CloudView ledger', 500);
  }
}
