import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, paginatedResponse, errorResponse, logActivity } from '@/lib/api-utils';
import { Prisma, RoleType } from '@prisma/client';
import { getEmailValidationError } from '@/lib/email-validation';
import { ensureCloudViewRestaurantLedger } from '@/lib/cloudview-ledger';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const search = searchParams.get('search')?.trim();
    const activeOnly = searchParams.get('activeOnly') !== 'false';

    const skip = (page - 1) * limit;
    const where: Prisma.CompanyLedgerWhereInput = {};

    if (activeOnly) where.active = true;

    // Hide system ledgers (e.g. CloudView) from the corporate company list by default.
    const includeSystem = searchParams.get('includeSystem') === 'true';
    if (!includeSystem) {
      where.isSystem = false;
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { contactPerson: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
        { guests: { some: { guestName: { contains: search } } } },
        { guests: { some: { registrationNumber: { contains: search } } } },
        { guests: { some: { phone: { contains: search } } } },
        {
          guests: {
            some: {
              bookings: {
                some: {
                  customer: { registrationNumber: { contains: search } },
                },
              },
            },
          },
        },
      ];
      const searchDigits = search.replace(/\D/g, '');
      if (searchDigits.length >= 4) {
        where.OR!.push(
          { guests: { some: { registrationNumber: { contains: searchDigits } } } },
          {
            guests: {
              some: {
                bookings: {
                  some: {
                    customer: { registrationNumber: { contains: searchDigits } },
                  },
                },
              },
            },
          }
        );
      }
    }

    await ensureCloudViewRestaurantLedger(db);

    const [companies, total] = await Promise.all([
      db.companyLedger.findMany({
        where,
        include: {
          _count: { select: { guests: true } },
        },
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      db.companyLedger.count({ where }),
    ]);

    return paginatedResponse(companies, total, page, limit);
  } catch (error) {
    console.error('Company ledger list error:', error);
    return errorResponse('Failed to fetch company ledger', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const name = String(body?.name || '').trim();
    if (!name) return errorResponse('Company name is required');

    const emailError = getEmailValidationError(body?.email, true);
    if (emailError) return errorResponse(emailError);

    const company = await db.companyLedger.create({
      data: {
        name,
        contactPerson: body?.contactPerson?.trim() || null,
        phone: body?.phone?.trim() || null,
        email: body?.email?.trim() || null,
        address: body?.address?.trim() || null,
        notes: body?.notes?.trim() || null,
        active: body?.active !== false,
      },
      include: { _count: { select: { guests: true } }, guests: true },
    });

    await logActivity(
      authResult.id,
      'CREATE',
      'company-ledger',
      JSON.stringify({ companyLedgerId: company.id, name: company.name })
    );

    return successResponse(company, 'Company added to ledger', 201);
  } catch (error) {
    console.error('Company ledger create error:', error);
    return errorResponse('Failed to create company ledger entry', 500);
  }
}
