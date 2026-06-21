import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessHotel } from '@/lib/auth';
import { successResponse, errorResponse, paginatedResponse, logActivity } from '@/lib/api-utils';
import { parsePaymentMethod } from '@/lib/payment-method';
import {
  depositRequiresBank,
  depositRequiresLastFour,
  isValidAccountLastFour,
} from '@/lib/deposit-form';
import { BANGLADESH_BANKS } from '@/lib/bangladesh-banks';
import { stampCurrentBusinessDate } from '@/lib/business-date';
import { PaymentMethod, Prisma } from '@prisma/client';

const ALLOWED_DEPOSIT_METHODS = new Set<PaymentMethod>([
  'CASH',
  'BANK',
  'CARD',
  'BKASH',
  'NAGAD',
  'UPAY',
]);

function parseDepositedAt(value: unknown): Date {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

// GET /api/deposits — list hotel deposit records
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    if (!canAccessHotel(authResult.role)) {
      return errorResponse('You do not have permission to view deposits', 403);
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
    const method = searchParams.get('method') as PaymentMethod | null;
    const search = searchParams.get('search')?.trim() ?? '';
    const startDate = searchParams.get('startDate') || searchParams.get('dateFrom');
    const endDate = searchParams.get('endDate') || searchParams.get('dateTo');
    const skip = (page - 1) * limit;

    const where: Prisma.HotelDepositWhereInput = {};

    if (method && method !== 'all' && method !== 'NONE') {
      where.method = method;
    }

    if (search) {
      where.OR = [
        { reference: { contains: search } },
        { notes: { contains: search } },
        { bankName: { contains: search } },
        { accountLastFour: { contains: search } },
        { depositor: { name: { contains: search } } },
      ];
    }

    if (startDate || endDate) {
      const depositedAt: Prisma.DateTimeFilter = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!Number.isNaN(start.getTime())) {
          start.setHours(0, 0, 0, 0);
          depositedAt.gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          depositedAt.lte = end;
        }
      }
      if (depositedAt.gte || depositedAt.lte) {
        where.depositedAt = depositedAt;
      }
    }

    const [deposits, total, sumResult] = await Promise.all([
      db.hotelDeposit.findMany({
        where,
        include: {
          depositor: { select: { id: true, name: true, role: true } },
        },
        orderBy: { depositedAt: 'desc' },
        skip,
        take: limit,
      }),
      db.hotelDeposit.count({ where }),
      db.hotelDeposit.aggregate({
        where,
        _sum: { amount: true },
      }),
    ]);

    return paginatedResponse(deposits, total, page, limit, {
      sumAmount: sumResult._sum.amount ?? 0,
    });
  } catch (error) {
    console.error('Deposits list error:', error);
    return errorResponse('Failed to fetch deposits', 500);
  }
}

// POST /api/deposits — record a new hotel deposit
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    if (!canAccessHotel(authResult.role)) {
      return errorResponse('You do not have permission to record deposits', 403);
    }

    const body = await request.json();
    const amount = Number(body?.amount);
    const method = parsePaymentMethod(body?.method, 'CASH');
    const bankName = body?.bankName ? String(body.bankName).trim() : null;
    const accountLastFour = body?.accountLastFour
      ? String(body.accountLastFour).trim()
      : null;
    const reference = body?.reference ? String(body.reference).trim() : null;
    const notes = body?.notes ? String(body.notes).trim() : null;
    const depositedAt = parseDepositedAt(body?.depositedAt);

    if (method === 'NONE' || !ALLOWED_DEPOSIT_METHODS.has(method)) {
      return errorResponse('Please select a valid deposit method');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return errorResponse('Deposit amount must be greater than 0');
    }
    if (depositRequiresBank(method)) {
      if (!bankName) {
        return errorResponse('Please select a bank');
      }
      if (!BANGLADESH_BANKS.includes(bankName as (typeof BANGLADESH_BANKS)[number])) {
        return errorResponse('Please select a bank from the list');
      }
    }
    if (depositRequiresLastFour(method)) {
      if (!accountLastFour || !isValidAccountLastFour(accountLastFour)) {
        return errorResponse('Last 4 digits are required for this payment method');
      }
    }

    const businessDate = await stampCurrentBusinessDate();

    const deposit = await db.hotelDeposit.create({
      data: {
        amount,
        method,
        businessDate,
        bankName: depositRequiresBank(method) ? bankName : null,
        accountLastFour: depositRequiresLastFour(method) ? accountLastFour : null,
        reference,
        notes,
        depositedBy: authResult.id,
        depositedAt,
      },
      include: {
        depositor: { select: { id: true, name: true, role: true } },
      },
    });

    await logActivity(
      authResult.id,
      'HOTEL_DEPOSIT_CREATE',
      'billing',
      JSON.stringify({
        depositId: deposit.id,
        amount: deposit.amount,
        method: deposit.method,
        reference: deposit.reference,
      })
    );

    return successResponse(deposit, 'Deposit recorded successfully');
  } catch (error) {
    console.error('Deposit create error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to record deposit';
    return errorResponse(
      message.includes('Prisma') || message.includes('PaymentMethod')
        ? 'Deposit could not be saved. Restart the dev server after schema changes, then try again.'
        : message,
      500
    );
  }
}
